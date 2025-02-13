import * as crypto from '../../crypto'
import { Shardus, ShardusTypes } from '@shardus/core'
import * as utils from './../../utils'
import * as config from './../../config'
import * as AccountsStorage from '../../storage/accountStorage'
import { UserAccount, WrappedStates, Tx, TransactionKeys, NodeAccount, AppReceiptData } from './../../@types'

export const validate_fields = (tx: Tx.WithdrawStake, response: ShardusTypes.IncomingTransactionResult) => {
  if (typeof tx.nominator !== 'string' && utils.isValidAddress(tx.nominator) === false) {
    response.success = false
    response.reason = 'tx "nominator" field must be a string and valid address.'
    throw new Error(response.reason)
  }
  if (typeof tx.nominee !== 'string' && utils.isValidAddress(tx.nominee) === false) {
    response.success = false
    response.reason = 'tx "nominee" field must be a string and valid address.'
    throw new Error(response.reason)
  }
  if (typeof tx.force !== 'boolean') {
    response.success = false
    response.reason = 'tx "force" field must be a boolean.'
    throw new Error(response.reason)
  }
  if (tx.sign.owner !== tx.nominator) {
    response.reason = 'not signed by nominator account'
    throw new Error(response.reason)
  }
  if (crypto.verifyObj(tx) === false) {
    response.reason = 'incorrect signing'
    throw new Error(response.reason)
  }
  return response
}

export const validate = (tx: Tx.WithdrawStake, wrappedStates: WrappedStates, response: ShardusTypes.IncomingTransactionResult, dapp: Shardus) => {
  const nominatorAccount: UserAccount = wrappedStates[tx.nominator] && wrappedStates[tx.nominator].data
  const nodeAccount: NodeAccount = wrappedStates[tx.nominee] && wrappedStates[tx.nominee].data
  if (typeof nominatorAccount === 'undefined' || nominatorAccount === null) {
    response.reason = 'nominator account does not exist'
    return response
  }
  if (typeof nodeAccount === 'undefined' || nodeAccount === null) {
    response.reason = 'nominee account does not exist'
    return response
  }
  if (nominatorAccount.operatorAccountInfo === undefined || nominatorAccount.operatorAccountInfo === null) {
    response.reason = 'nominator account does not have operator account info'
    return response
  }
  if (nominatorAccount.operatorAccountInfo.nominee === '') {
    response.reason = 'nominator account has not staked to any node yet'
    return response
  }
  if (nominatorAccount.operatorAccountInfo.nominee !== tx.nominee) {
    response.reason = 'nominator account has already staked to a different node'
    return response
  }
  if (nodeAccount.nominator == null || nodeAccount.nominator === '') {
    response.reason = 'No one has staked to this node yet'
    return response
  }
  if (nodeAccount.nominator !== tx.nominator) {
    response.reason = 'Node account has already been staked to another nominator'
    return response
  }
  if (nodeAccount.stakeLock === BigInt(0)) {
    response.reason = 'Node account has zero stake'
    return response
  }

  if (dapp.isOnStandbyList(nodeAccount.id) === true) {
    response.reason = `This node is in the network's Standby list. You can unstake only after the node leaves the Standby list!`
    return response
  }
  if (dapp.isNodeActiveByPubKey(nodeAccount.id) === true) {
    response.reason = `This node is still active in the network. You can unstake only after the node leaves the network!`
    return response
  }
  if (nodeAccount.rewardEndTime === 0 && nodeAccount.rewardStartTime > 0 && !(tx.force && config.LiberdusFlags.allowForceUnstake)) {
    response.reason = `No reward endTime set, can't unstake node yet`
    return response
  }
  if (nominatorAccount.operatorAccountInfo.certExp > tx.timestamp) {
    response.reason = `Unable to apply Unstake tx because stake cert has not yet expired. Expiry timestamp ${nominatorAccount.operatorAccountInfo.certExp}`
    return response
  }
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (
  tx: Tx.WithdrawStake,
  txTimestamp: number,
  txId: string,
  wrappedStates: WrappedStates,
  dapp: Shardus,
  applyResponse: ShardusTypes.ApplyResponse,
): void => {
  const nominatorAccount: UserAccount = wrappedStates[tx.nominator].data
  const nodeAccount: NodeAccount = wrappedStates[tx.nominee] && wrappedStates[tx.nominee].data

  const currentBalance = nominatorAccount.data.balance
  const stake = nodeAccount.stakeLock
  let reward = nodeAccount.reward
  if (nodeAccount.rewardEndTime === 0 && nodeAccount.rewardStartTime > 0) {
    // This block will only be reached if the node is inactive and the force unstake flag has been set
    reward = BigInt(0)
  }

  const txFeeUsd = AccountsStorage.cachedNetworkAccount.current.transactionFee
  const txFee = utils.scaleByStabilityFactor(txFeeUsd, AccountsStorage.cachedNetworkAccount)
  // [TODO] check if the maintainance fee is also needed in withdraw_stake tx
  const maintenanceFee = utils.maintenanceAmount(txTimestamp, nominatorAccount, AccountsStorage.cachedNetworkAccount)
  console.log('currentBalance', currentBalance, 'stake', stake, 'reward', reward, 'txFee', txFee, 'maintenanceFee', maintenanceFee)
  const newBalance = currentBalance + stake + reward - txFee - maintenanceFee
  console.log('newBalance', newBalance)
  nominatorAccount.data.balance = newBalance
  nominatorAccount.operatorAccountInfo.stake = BigInt(0)
  nominatorAccount.operatorAccountInfo.nominee = ''
  nominatorAccount.operatorAccountInfo.certExp = 0

  // update the operator historical stats
  nominatorAccount.operatorAccountInfo.operatorStats.totalUnstakeReward = nominatorAccount.operatorAccountInfo.operatorStats.totalUnstakeReward + reward
  nominatorAccount.operatorAccountInfo.operatorStats.unstakeCount += 1
  nominatorAccount.operatorAccountInfo.operatorStats.lastStakedNodeKey = tx.nominee

  nodeAccount.nominator = ''
  nodeAccount.stakeLock = BigInt(0)
  nodeAccount.penalty = BigInt(0)
  nodeAccount.reward = BigInt(0)
  nodeAccount.rewardStartTime = 0
  nodeAccount.rewardEndTime = 0

  nominatorAccount.timestamp = txTimestamp
  nodeAccount.timestamp = txTimestamp
  // nominator.data.transactions.push({ ...tx, txId })

  const appReceiptData: AppReceiptData = {
    txId,
    timestamp: txTimestamp,
    success: true,
    from: tx.nominator,
    to: tx.nominee,
    type: tx.type,
    transactionFee: txFee,
    additionalInfo: {
      maintenanceFee,
      stake,
      reward,
      totalUnstakeAmount: stake + reward,
    },
  }
  dapp.applyResponseAddReceiptData(applyResponse, appReceiptData, txId)
  dapp.log('Applied withdraw_stake tx', nominatorAccount, nodeAccount)
}

export const keys = (tx: Tx.WithdrawStake, result: TransactionKeys) => {
  result.sourceKeys = [tx.nominator]
  result.targetKeys = [tx.nominee]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}

export const memoryPattern = (tx: Tx.WithdrawStake, result: TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  return {
    rw: [tx.nominee, tx.nominator],
    wo: [],
    on: [],
    ri: [],
    ro: [],
  }
}
export const createRelevantAccount = (dapp: Shardus, account: UserAccount, accountId: string, tx: Tx.WithdrawStake, accountCreated = false) => {
  if (!account) {
    throw new Error('Account must already exist in order to perform the withdraw_stake transaction')
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}
