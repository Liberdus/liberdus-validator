import { Shardus, ShardusTypes } from '@shardus/core'
import create from '../accounts'
import * as config from '../config'
import { Accounts, UserAccount, WrappedStates, Tx, TransactionKeys, AppReceiptData } from '../@types'

export const validate_fields = (tx: Tx.Create, response: ShardusTypes.IncomingTransactionResult) => {
  if (typeof tx.from !== 'string') {
    response.success = false
    response.reason = '"From" must be a string.'
    throw new Error(response.reason)
  }
  if (typeof tx.amount !== 'bigint' || tx.amount <= BigInt(0)) {
    response.success = false
    response.reason = 'tx "amount" field must be a bigint and greater than 0.'
    throw new Error(response.reason)
  }
  return response
}

export const validate = (tx: Tx.Create, wrappedStates: WrappedStates, response: ShardusTypes.IncomingTransactionResult, dapp: Shardus) => {
  const from: Accounts = wrappedStates[tx.from] && wrappedStates[tx.from].data
  if (from === undefined || from === null) {
    response.reason = "target account doesn't exist"
    return response
  }
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (
  tx: Tx.Create,
  txTimestamp: number,
  txId: string,
  wrappedStates: WrappedStates,
  dapp: Shardus,
  applyResponse: ShardusTypes.ApplyResponse,
): void => {
  const from: UserAccount = wrappedStates[tx.from].data
  from.data.balance += tx.amount
  from.timestamp = txTimestamp
  // from.data.transactions.push({ ...tx, txId })

  const appReceiptData: AppReceiptData = {
    txId,
    timestamp: txTimestamp,
    success: true,
    from: tx.from,
    to: tx.from,
    type: tx.type,
    transactionFee: BigInt(0),
  }
  dapp.applyResponseAddReceiptData(applyResponse, appReceiptData, txId)

  dapp.log('Applied create tx', from)
}

export const keys = (tx: Tx.Create, result: TransactionKeys) => {
  result.sourceKeys = [tx.from]
  result.allKeys = [...result.sourceKeys]
  return result
}

export const memoryPattern = (tx: Tx.Create, result: TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  return {
    rw: [tx.from],
    wo: [],
    on: [],
    ri: [],
    ro: [],
  }
}
export const createRelevantAccount = (dapp: Shardus, account: UserAccount, accountId: string, tx: Tx.Create, accountCreated = false) => {
  if (!account) {
    account = create.userAccount(accountId, tx.timestamp)
    accountCreated = true
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}
