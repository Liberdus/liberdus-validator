import * as crypto from '../crypto'
import * as LiberdusTypes from '../@types'
import { Shardus, ShardusTypes } from '@shardus/core'
import * as utils from '../utils'
import * as config from '../config'
import { Accounts, UserAccount, NetworkAccount, IssueAccount, WrappedStates, ProposalAccount, Tx, TransactionKeys } from '../@types'
import { toShardusAddress, toShardusAddressWithKey } from '../utils/address'

export const validate_fields = (tx: Tx.Transfer, response: ShardusTypes.IncomingTransactionResult) => {
  if (typeof tx.from !== 'string') {
    response.success = false
    response.reason = 'tx "from" field must be a string.'
    throw new Error(response.reason)
  }
  if (typeof tx.to !== 'string') {
    response.success = false
    response.reason = 'tx "to" field must be a string.'
    throw new Error(response.reason)
  }
  if (typeof tx.amount !== 'bigint' || tx.amount <= BigInt(0)) {
    response.success = false
    response.reason = 'tx "amount" field must be a bigint and greater than 0.'
    throw new Error(response.reason)
  }
  if (tx.memo && typeof tx.memo !== 'string') {
    response.success = false
    response.reason = 'tx "memo" field must be a string.'
    throw new Error(response.reason)
  }
  if (tx.memo && tx.memo.length > config.LiberdusFlags.transferMemoLimit) {
    response.success = false
    response.reason = `tx "memo" size must be less than ${config.LiberdusFlags.transferMemoLimit} characters.`
    throw new Error(response.reason)
  }
  return response
}

export const validate = (tx: Tx.Transfer, wrappedStates: WrappedStates, response: ShardusTypes.IncomingTransactionResult, dapp: Shardus) => {
  let clonedTx = { ...tx }
  if (config.LiberdusFlags.useEthereumAddress) {
    clonedTx.from = toShardusAddress(tx.from)
    clonedTx.to = toShardusAddress(tx.to)
  }
  const from: Accounts = wrappedStates[clonedTx.from] && wrappedStates[clonedTx.from].data
  const to: Accounts = wrappedStates[clonedTx.to] && wrappedStates[clonedTx.to].data
  const network: NetworkAccount = wrappedStates[config.networkAccount].data
  if (tx.sign.owner !== tx.from) {
    response.reason = 'not signed by from account'
    return response
  }
  if (crypto.verifyObj(tx) === false) {
    response.reason = 'incorrect signing'
    return response
  }
  if (from === undefined || from === null) {
    response.reason = "from account doesn't exist"
    return response
  }
  if (to === undefined || to === null) {
    response.reason = "To account doesn't exist"
    return response
  }

  if (from.data.balance < tx.amount + network.current.transactionFee) {
    response.reason = "from account doesn't have sufficient balance to cover the transaction"
    return response
  }
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (tx: Tx.Transfer, txTimestamp: number, txId: string, wrappedStates: WrappedStates, dapp: Shardus, applyResponse: any) => {
  const from = wrappedStates[tx.from].data
  const to: UserAccount = wrappedStates[tx.to].data
  const network: NetworkAccount = wrappedStates[config.networkAccount].data
  from.data.balance -= tx.amount + network.current.transactionFee
  from.data.balance -= utils.maintenanceAmount(txTimestamp, from, network)
  to.data.balance += tx.amount
  from.timestamp = txTimestamp
  to.timestamp = txTimestamp

  const receipt = Object.assign({}, tx, { txId, success: true })
  dapp.applyResponseAddReceiptData(applyResponse, receipt, txId)
  dapp.log('Applied transfer tx', from, to)
}

export const transactionReceiptPass = (tx: Tx.Transfer, txId: string, wrappedStates: WrappedStates, dapp, applyResponse) => {
  if (applyResponse == null) return
  const appReceiptData = applyResponse.appReceiptData

  if (config.LiberdusFlags.VerboseLogs) {
    console.log('_transactionReceiptPass appReceiptData for transfer tx', txId, appReceiptData)
    console.log('_transactionReceiptPass appReceiptDataHash for transfer tx', txId, crypto.hashObj(appReceiptData))
  }

  if (appReceiptData) {
    const dataId = appReceiptData.txId
    dapp
      .sendCorrespondingCachedAppData('receipt', dataId, appReceiptData, dapp.stateManager.currentCycleShardData.cycleNumber, tx.from, appReceiptData.txId)
      .then(() => {
        dapp.log('PostApplied transfer tx', tx, appReceiptData)
      })
      .catch((err) => {
        throw new Error(`Error in sending receipt for transfer tx: ${err.message}`)
      })
  }
}

export const keys = (tx: Tx.Transfer, result: TransactionKeys) => {
  result.sourceKeys = [tx.from]
  result.targetKeys = [tx.to, config.networkAccount]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}

export const memoryPattern = (tx: Tx.Transfer, result: TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  const memoryPattern: ShardusTypes.ShardusMemoryPatternsInput = {
    rw: [tx.from, tx.to],
    wo: [],
    on: [],
    ri: [],
    ro: [config.networkAccount],
  }
  return memoryPattern
}
export const createRelevantAccount = (dapp: Shardus, account: UserAccount, accountId: string, tx: Tx.Transfer, accountCreated = false) => {
  if (!account) {
    throw Error('Account must exist in order to send a transfer transaction')
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}

export const collectWrappedStates = async (tx: Tx.Transfer, dapp: Shardus): Promise<WrappedStates> => {
  const promises = []
  const accounts = [tx.from, tx.to, config.networkAccount]
  const wrappedStates: WrappedStates = {}
  const txTimestamp = utils.getInjectedOrGeneratedTimestamp({ tx: tx }, dapp)

  for (const accountId of accounts) {
    const shardusId = toShardusAddress(accountId)
    promises.push(dapp.getLocalOrRemoteAccount(shardusId).then((queuedWrappedState)=>{
      console.log('queuedWrappedState', queuedWrappedState)
      wrappedStates[shardusId] = {
        accountId: queuedWrappedState.accountId,
        stateId: queuedWrappedState.stateId,
        data: queuedWrappedState.data as LiberdusTypes.Accounts,
        timestamp: txTimestamp,

      }
    }))
  }

  await Promise.allSettled(promises)
  return wrappedStates 
}


