import { Shardus, ShardusTypes } from '@shardus/core'
import create from '../accounts'
import * as config from '../config'
import { Accounts, UserAccount, NetworkAccount, NodeAccount, WrappedStates, ProposalAccount, Tx, TransactionKeys, AppReceiptData } from '../@types'

export const validate_fields = (tx: Tx.NodeReward, response: ShardusTypes.IncomingTransactionResult) => {
  if (typeof tx.from !== 'string') {
    response.success = false
    response.reason = 'tx "from" field must be a string'
    throw new Error(response.reason)
  }
  if (typeof tx.nodeId !== 'string') {
    response.success = false
    response.reason = 'tx "nodeId" field must be a string'
    throw new Error(response.reason)
  }
  if (typeof tx.to !== 'string') {
    response.success = false
    response.reason = 'tx "to" field must be a string'
    throw new Error(response.reason)
  }
  return response
}

export const validate = (tx: Tx.NodeReward, wrappedStates: WrappedStates, response: ShardusTypes.IncomingTransactionResult, dapp: Shardus) => {
  const from: Accounts = wrappedStates[tx.from] && wrappedStates[tx.from].data
  const network: NetworkAccount = wrappedStates[config.networkAccount].data
  let nodeInfo
  try {
    nodeInfo = dapp.getNode(tx.nodeId)
  } catch (err) {
    dapp.log(err)
  }
  if (!nodeInfo) {
    response.reason = 'no nodeInfo'
    return response
  }
  if (tx.timestamp - nodeInfo.activeTimestamp < network.current.nodeRewardInterval) {
    response.reason = 'Too early for this node to get a reward'
    return response
  }
  if (!from) {
    response.success = true
    response.reason = 'This transaction in valid'
    return response
  }
  if (from) {
    if (!from.nodeRewardTime) {
      response.success = true
      response.reason = 'This transaction in valid'
      return response
    }
    if (tx.timestamp - from.nodeRewardTime < network.current.nodeRewardInterval) {
      response.reason = 'Too early for this node to get paid'
      return response
    }
  }
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (
  tx: Tx.NodeReward,
  txTimestamp: number,
  txId: string,
  wrappedStates: WrappedStates,
  dapp: Shardus,
  applyResponse: ShardusTypes.ApplyResponse,
): void => {
  const from: NodeAccount = wrappedStates[tx.from].data
  const to: UserAccount = wrappedStates[tx.to].data
  const network: NetworkAccount = wrappedStates[config.networkAccount].data
  //const nodeAccount: NodeAccount = to
  from.balance += network.current.nodeRewardAmountUsd
  dapp.log(`Reward from ${tx.from} to ${tx.to}`)
  if (tx.from !== tx.to) {
    dapp.log('Node reward to and from are different.')
    dapp.log('TO ACCOUNT', to.data)
    if (to.data.stake >= network.current.stakeRequiredUsd) {
      to.data.balance += from.balance
      if (to.data.remove_stake_request) to.data.remove_stake_request = null
      from.balance = BigInt(0)
      to.timestamp = txTimestamp
    }
  }
  from.nodeRewardTime = txTimestamp
  from.timestamp = txTimestamp
  //NodeAccount does not have transactions
  //to.data.transactions.push({ ...tx, txId })

  const appReceiptData: AppReceiptData = {
    txId,
    timestamp: txTimestamp,
    success: true,
    from: tx.from,
    to: tx.to,
    type: tx.type,
    transactionFee: BigInt(0),
  }
  dapp.applyResponseAddReceiptData(applyResponse, appReceiptData, txId)
  dapp.log('Applied node_reward tx', from, to)
}

export const keys = (tx: Tx.NodeReward, result: TransactionKeys) => {
  result.sourceKeys = [tx.from]
  result.targetKeys = [tx.to, config.networkAccount]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}

export const memoryPattern = (tx: Tx.NodeReward, result: TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  return {
    rw: [tx.from, tx.to],
    wo: [],
    on: [],
    ri: [],
    ro: [config.networkAccount],
  }
}

export const createRelevantAccount = (dapp: Shardus, account: NodeAccount | UserAccount, accountId: string, tx: Tx.NodeReward, accountCreated = false) => {
  if (!account) {
    if (accountId === tx.nodeId) {
      account = create.nodeAccount(accountId)
    } else {
      throw new Error('UserAccount must already exist for the node_reward transaction')
    }
    accountCreated = true
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}
