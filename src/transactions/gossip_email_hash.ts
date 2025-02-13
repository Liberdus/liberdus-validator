import { Shardus, ShardusTypes } from '@shardus/core'
import create from '../accounts'
import * as config from '../config'
import { NodeAccount, UserAccount, NetworkAccount, IssueAccount, WrappedStates, ProposalAccount, Tx, TransactionKeys, AppReceiptData } from '../@types'

export const validate_fields = (tx: Tx.GossipEmailHash, response: ShardusTypes.IncomingTransactionResult) => {
  if (typeof tx.nodeId !== 'string') {
    response.success = false
    response.reason = 'tx "nodeId" field must be a string.'
    throw new Error(response.reason)
  }
  if (typeof tx.from !== 'string') {
    response.success = false
    response.reason = 'tx "from" field must be a string.'
    throw new Error(response.reason)
  }
  if (typeof tx.account !== 'string') {
    response.success = false
    response.reason = 'tx "account" field must be a string.'
    throw new Error(response.reason)
  }
  if (typeof tx.emailHash !== 'string') {
    response.success = false
    response.reason = 'tx "emailHash" field must be a string.'
    throw new Error(response.reason)
  }
  if (typeof tx.verified !== 'string') {
    response.success = false
    response.reason = 'tx "verified" field must be a string.'
    throw new Error(response.reason)
  }
  return response
}

export const validate = (tx: Tx.GossipEmailHash, wrappedStates: WrappedStates, response: ShardusTypes.IncomingTransactionResult, dapp: Shardus) => {
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (
  tx: Tx.GossipEmailHash,
  txTimestamp: number,
  txId: string,
  wrappedStates: WrappedStates,
  dapp: Shardus,
  applyResponse: ShardusTypes.ApplyResponse,
): void => {
  // const targets = tx.targets.map(target => wrappedStates[target].data)
  const account: UserAccount = wrappedStates[tx.account].data
  account.emailHash = tx.emailHash
  account.verified = tx.verified
  account.timestamp = txTimestamp

  const appReceiptData: AppReceiptData = {
    txId,
    timestamp: txTimestamp,
    success: true,
    from: tx.account,
    to: tx.account,
    type: tx.type,
    transactionFee: BigInt(0),
  }
  dapp.applyResponseAddReceiptData(applyResponse, appReceiptData, txId)
  dapp.log('Applied gossip_email_hash tx', account)
}

export const keys = (tx: Tx.GossipEmailHash, result: TransactionKeys) => {
  result.sourceKeys = [tx.from]
  result.targetKeys = [tx.account]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}

export const memoryPattern = (tx: Tx.GossipEmailHash, result: TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  return {
    rw: [tx.from],
    wo: [],
    on: [],
    ri: [],
    ro: [],
  }
}

export const createRelevantAccount = (dapp: Shardus, account: NodeAccount, accountId: string, tx: Tx.GossipEmailHash, accountCreated = false) => {
  if (!account) {
    account = create.nodeAccount(accountId)
    accountCreated = true
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}
