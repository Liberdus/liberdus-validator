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
  if (to.data.friends[toShardusAddress(tx.from)]) {
    if (from.data.balance < network.current.transactionFee) {
      response.reason = `from account does not have sufficient funds: ${from.data.balance} to cover transaction fee: ${network.current.transactionFee}.`
      return response
    }
  } else {
    if (to.data.toll === null) {
      if (from.data.balance < network.current.defaultToll + network.current.transactionFee) {
        response.reason = `from account does not have sufficient funds ${from.data.balance} to cover the default toll + transaction fee ${
          network.current.defaultToll + network.current.transactionFee
        }.`
        return response
      }
    } else {
      if (from.data.balance < to.data.toll + network.current.transactionFee) {
        response.reason = 'from account does not have sufficient funds.'
        return response
      }
    }
  }
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (tx: Tx.Message, txTimestamp: number, txId: string, wrappedStates: WrappedStates, dapp: Shardus) => {
  const from: UserAccount = wrappedStates[tx.from].data
  const to: UserAccount = wrappedStates[tx.to].data
  const network: NetworkAccount = wrappedStates[config.networkAccount].data
  const chat = wrappedStates[tx.chatId].data
  from.data.balance -= network.current.transactionFee
  if (!to.data.friends[from.id]) {
    if (to.data.toll === null) {
      from.data.balance -= network.current.defaultToll
      to.data.balance += network.current.defaultToll
    } else {
      from.data.balance -= to.data.toll
      to.data.balance += to.data.toll
    }
  }
  from.data.balance -= utils.maintenanceAmount(txTimestamp, from, network)

  if (!from.data.chats[tx.to]) {
    from.data.chats[tx.to] = {
      receivedTimestamp: 0,
      chatId: tx.chatId,
    }
  }
  from.data.chatTimestamp = txTimestamp
  to.data.chats[tx.from] = {
    receivedTimestamp: txTimestamp,
    chatId: tx.chatId,
  }
  to.data.chatTimestamp = txTimestamp

  chat.messages.push(tx)
  // from.data.transactions.push({ ...tx, txId })
  // to.data.transactions.push({ ...tx, txId })

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
