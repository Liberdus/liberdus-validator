import * as crypto from '../crypto'
import { Shardus, ShardusTypes } from '@shardus/core'
import * as utils from '../utils'
import create from '../accounts'
import * as config from '../config'
import { Accounts, UserAccount, NetworkAccount, ChatAccount, WrappedStates, ProposalAccount, Tx, TransactionKeys } from '../@types'
import { toShardusAddress } from '../utils/address'

export const validate_fields = (tx: Tx.Message, response: ShardusTypes.IncomingTransactionResult) => {
  if (typeof tx.from !== 'string' && utils.isValidAddress(tx.from) === false) {
    response.success = false
    response.reason = 'tx "from" field must be a string.'
    throw new Error(response.reason)
  }
  if (typeof tx.to !== 'string' && utils.isValidAddress(tx.to) === false) {
    response.success = false
    response.reason = 'tx "to" field must be a string.'
    throw new Error(response.reason)
  }
  if (typeof tx.chatId !== 'string' && utils.isValidAddress(tx.chatId) === false) {
    response.success = false
    response.reason = 'tx "chatId" field must be a valid address string.'
    throw new Error(response.reason)
  }
  if (tx.chatId !== utils.calculateChatId(tx.from, tx.to)) {
    response.success = false
    response.reason = 'chatId is not calculated correctly for from and to addresses'
    throw new Error(response.reason)
  }
  if (typeof tx.message !== 'string') {
    response.success = false
    response.reason = 'tx "message" field must be a string.'
    throw new Error(response.reason)
  }
  const messageSizeInKb = Buffer.byteLength(tx.message, 'utf8') / 1024
  if (messageSizeInKb > config.LiberdusFlags.messageSizeLimit) {
    response.success = false
    response.reason = `tx "message" size must be less than ${config.LiberdusFlags.messageSizeLimit} kB.`
    throw new Error(response.reason)
  }
  return response
}

export const validate = (tx: Tx.Message, wrappedStates: WrappedStates, response: ShardusTypes.IncomingTransactionResult, dapp: Shardus) => {
  const clonedTx = { ...tx }
  if (config.LiberdusFlags.useEthereumAddress) {
    clonedTx.from = toShardusAddress(tx.from)
    clonedTx.to = toShardusAddress(tx.to)
  }
  const from: Accounts = wrappedStates[clonedTx.from] && wrappedStates[clonedTx.from].data
  const network: NetworkAccount = wrappedStates[config.networkAccount].data
  const to: Accounts = wrappedStates[clonedTx.to] && wrappedStates[clonedTx.to].data
  const chat: ChatAccount = wrappedStates[tx.chatId] && wrappedStates[tx.chatId].data

  if (!from || !to) {
    response.reason = 'from or to account does not exist.'
    return response
  }

  if (tx.sign.owner !== tx.from) {
    response.reason = 'not signed by from account'
    return response
  }
  if (crypto.verifyObj(tx) === false) {
    response.reason = 'incorrect signing'
    return response
  }
  if (typeof from === 'undefined' || from === null) {
    response.reason = '"from" account does not exist.'
    return response
  }
  if (typeof to === 'undefined' || to === null) {
    response.reason = '"target" account does not exist.'
    return response
  }

  // Calculate required toll based on chat account state
  let requiredToll = BigInt(0)
  if (chat && chat.hasChats) {
    // Get sender index based on sorted addresses
    const [addr1, addr2] = utils.sortAddresses(tx.from, tx.to)
    const senderIndex = addr1 === tx.from ? 0 : 1

    // Check if sender needs to pay toll
    if (chat.toll.required[senderIndex] === 1) {
      requiredToll = to.data.toll === null ? network.current.defaultToll : to.data.toll
    }
  } else {
    // For new chats, sender always pays toll
    requiredToll = to.data.toll === null ? network.current.defaultToll : to.data.toll
  }

  // Validate balance covers toll + transaction fee
  if (from.data.balance < requiredToll + network.current.transactionFee) {
    response.reason = `from account does not have sufficient funds ${from.data.balance} to cover the toll (${requiredToll}) + transaction fee (${network.current.transactionFee}).`
    return response
  }

  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (tx: Tx.Message, txTimestamp: number, txId: string, wrappedStates: WrappedStates, dapp: Shardus) => {
  const from: UserAccount = wrappedStates[tx.from].data
  const to: UserAccount = wrappedStates[tx.to].data
  const network: NetworkAccount = wrappedStates[config.networkAccount].data
  const chat: ChatAccount = wrappedStates[tx.chatId].data
  let tollDeposited = 0n

  if (config.LiberdusFlags.VerboseLogs) {
    dapp.log(`Applying message tx: ${txId}`, tx, from, to, chat)
  }

  if (!chat) {
    throw Error('getRelevantAccount must be called before apply')
  }

  // Deduct transaction fee
  from.data.balance -= network.current.transactionFee

  // Deduct maintenance fee
  from.data.balance -= utils.maintenanceAmount(txTimestamp, from, network)

  // Handle toll for new or existing chat
  const [addr1, addr2] = utils.sortAddresses(tx.from, tx.to)
  const senderIndex = addr1 === tx.from ? 0 : 1
  const receiverIndex = 1 - senderIndex

  // fail the tx if the chat is blocked
  if (chat.toll.required[receiverIndex] === 2) {
    if (config.LiberdusFlags.VerboseLogs) dapp.log(`txId: ${txId} chat is blocked`, chat)
    from.timestamp = txTimestamp
    dapp.log('Applied message tx', chat, from, to)
    return
  }

  // search last chat message (not transfer) from the end of the messages array
  let lastMessage = null
  if (chat.hasChats) {
    for (const message of chat.messages.slice().reverse()) {
      if (message.type === 'message') {
        lastMessage = message
        break
      }
    }
  }
  dapp.log(`txId: ${txId} lastMessage`, lastMessage)
  dapp.log(`Is last message from the other party?`, lastMessage && lastMessage.from === tx.to)
  dapp.log(`Is last message older than tollTimeout?`, lastMessage && lastMessage.timestamp + network.current.tollTimeout > txTimestamp)
  dapp.log(`payOnReply`, chat.toll.payOnReply[senderIndex])

  // Process toll
  if (
    lastMessage &&
    lastMessage.from === tx.to &&
    chat.toll.payOnReply[senderIndex] > 0n &&
    lastMessage.timestamp + network.current.tollTimeout > txTimestamp
  ) {
    // replying to a message from the other party
    const readToll = chat.toll.payOnRead[senderIndex] // this can be zero if the person replying has read the message
    const replyToll = chat.toll.payOnReply[senderIndex]
    const totalToll = readToll + replyToll

    // Calculate network fee
    const networkFee = (totalToll * BigInt(network.current.tollNetworkTaxPercent) * 10n ** 18n) / (100n * 10n ** 18n)
    const userAmount = totalToll - networkFee

    // Clear the toll pools
    chat.toll.payOnRead[senderIndex] = 0n
    chat.toll.payOnReply[senderIndex] = 0n

    // Transfer toll to replier
    from.data.balance += userAmount
    dapp.log(`txId: ${txId} transferring toll to replier`, userAmount, networkFee)
  } else if (chat.toll.required[receiverIndex] === 1) {
    // receiver demands toll
    // Handle toll for new or existing chat when required
    tollDeposited = to.data.toll === null ? network.current.defaultToll : to.data.toll
    from.data.balance -= tollDeposited

    // Deposit toll in read and reply pools
    const halfToll = BigInt(tollDeposited) / 2n
    chat.toll.payOnRead[receiverIndex] += halfToll
    chat.toll.payOnReply[receiverIndex] += halfToll
  }

  // Update chat references
  if (!from.data.chats[tx.to]) {
    from.data.chats[tx.to] = {
      receivedTimestamp: 0,
      chatId: tx.chatId,
    }
  }

  if (!to.data.chats[tx.from]) {
    to.data.chats[tx.from] = {
      receivedTimestamp: txTimestamp,
      chatId: tx.chatId,
    }
  }

  // Add message to chat
  const messageRecord: Tx.MessageRecord = {
    ...tx,
    tollDeposited, // used for reclaiming toll
  }
  chat.messages.push(messageRecord)
  chat.hasChats = true

  // Update replied timestamp for sender
  chat.replied[senderIndex] = txTimestamp
  // Mark as read for sender
  chat.read[senderIndex] = txTimestamp

  // Update timestamps
  chat.timestamp = txTimestamp
  from.timestamp = txTimestamp
  to.timestamp = txTimestamp

  dapp.log('Applied message tx', chat, from, to)
}

export const keys = (tx: Tx.Message, result: TransactionKeys) => {
  result.sourceKeys = [tx.chatId, tx.from]
  result.targetKeys = [tx.to, config.networkAccount]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}

export const memoryPattern = (tx: Tx.Message, result: TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  return {
    rw: [tx.from, tx.to, tx.chatId],
    wo: [],
    on: [],
    ri: [],
    ro: [config.networkAccount],
  }
}

export const createRelevantAccount = (dapp: Shardus, account: UserAccount | ChatAccount, accountId: string, tx: Tx.Message, accountCreated = false) => {
  if (!account) {
    if (accountId === tx.chatId) {
      account = create.chatAccount(accountId)
    } else {
      throw Error('Account must exist in order to send a message transaction')
    }
    accountCreated = true
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}
