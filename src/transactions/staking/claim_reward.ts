import { nestedCountersInstance, Shardus, ShardusTypes } from '@shardus/core'
import * as crypto from '../../crypto'
import { LiberdusFlags } from '../../config'
import { logFlags } from '@shardus/core/dist/logger'
import { NodeAccount, UserAccount, WrappedStates, Tx, TransactionKeys, AppReceiptData } from '../../@types'
import * as AccountsStorage from '../../storage/accountStorage'
import { scaleByStabilityFactor, _sleep, generateTxId } from '../../utils'
import { TXTypes } from '..'
import { dapp } from '../..'

export async function injectClaimRewardTx(
  shardus: Shardus,
  eventData: ShardusTypes.ShardusEvent,
): Promise<{
  success: boolean
  reason: string
  status: number
}> {
  let wrappedData: ShardusTypes.WrappedData = await shardus.getLocalOrRemoteAccount(eventData.publicKey)

  if (wrappedData == null || wrappedData.data == null) {
    //try one more time
    wrappedData = await shardus.getLocalOrRemoteAccount(eventData.publicKey)
    if (wrappedData == null || wrappedData.data == null) {
      if (LiberdusFlags.VerboseLogs) console.log(`injectClaimRewardTx failed cant find : ${eventData.publicKey}`)
      nestedCountersInstance.countEvent('liberdus-staking', `injectClaimRewardTx failed cant find node`)
      return { success: false, reason: 'cant find node account', status: 500 }
    }
  }
  const nodeAccount = wrappedData.data as NodeAccount
  if (nodeAccount.nominator === '' || nodeAccount.nominator == null) {
    if (LiberdusFlags.VerboseLogs) console.log(`injectClaimRewardTx failed cant find nomimator : ${eventData.publicKey}`, nodeAccount)
    nestedCountersInstance.countEvent('liberdus-staking', `injectClaimRewardTx failed cant find nomimator`)
    return { success: false, reason: 'cant find nomimator', status: 500 }
  }
  // check if the rewardStartTime is negative
  if (nodeAccount.rewardStartTime < 0) {
    if (LiberdusFlags.VerboseLogs) console.log(`injectClaimRewardTx failed rewardStartTime < 0`)
    nestedCountersInstance.countEvent('liberdus-staking', `injectClaimRewardTx failed rewardStartTime < 0`)
    return { success: false, reason: 'rewardStartTime is less than 0', status: 500 }
  }
  // check if nodeAccount.rewardEndTime is already set to eventData.time
  if (nodeAccount.rewardEndTime >= eventData.additionalData.txData.endTime) {
    if (LiberdusFlags.VerboseLogs) console.log(`injectClaimRewardTx failed rewardEndTime already set : ${eventData.publicKey}`, nodeAccount)
    nestedCountersInstance.countEvent('liberdus-staking', `injectClaimRewardTx failed rewardEndTime already set`)
    return { success: false, reason: 'rewardEndTime already set', status: 500 }
  }

  let tx = {
    nominee: eventData.publicKey,
    nominator: nodeAccount.nominator,
    timestamp: shardus.shardusGetTime(),
    deactivatedNodeId: eventData.nodeId,
    nodeDeactivatedTime: eventData.additionalData.txData.endTime,
    cycle: eventData.cycleNumber,
    type: TXTypes.claim_reward,
  } as Omit<Tx.ClaimRewardTX, 'sign'>

  // to make sure that differnt nodes all submit an equivalent tx that is counted as the same tx,
  // we need to make sure that we have a determinstic timestamp
  const cycleEndTime = eventData.time
  let futureTimestamp = cycleEndTime * 1000
  while (futureTimestamp < shardus.shardusGetTime()) {
    futureTimestamp += 30 * 1000
  }
  const waitTime = futureTimestamp - shardus.shardusGetTime()
  tx.timestamp = futureTimestamp
  // since we have to pick a future timestamp, we need to wait until it is time to submit the tx
  await _sleep(waitTime)

  tx = shardus.signAsNode(tx)
  if (LiberdusFlags.VerboseLogs) {
    const latestCycles = shardus.getLatestCycles(1)
    const txId = generateTxId(tx)
    console.log(`injectClaimRewardTx: tx.timestamp: ${tx.timestamp} txid: ${txId}, cycle:`, tx, latestCycles[0])
  }
  const injectResult = await shardus.put(tx)
  return injectResult
}

export const validate_fields = (tx: Tx.ClaimRewardTX, response: ShardusTypes.IncomingTransactionResult) => {
  if (!tx.nominee || tx.nominee === '' || tx.nominee.length !== 64) {
    nestedCountersInstance.countEvent('liberdus-staking', `validateClaimRewardTx fail tx.nominee address invalid`)
    if (LiberdusFlags.VerboseLogs) console.log('validateClaimRewardTx fail tx.nominee address invalid', tx)
    response.success = false
    response.reason = 'Invalid nominee address'
    throw new Error(response.reason)
  }
  if (!tx.deactivatedNodeId || tx.deactivatedNodeId === '' || tx.deactivatedNodeId.length !== 64) {
    nestedCountersInstance.countEvent('liberdus-staking', `validateClaimRewardTx fail tx.deactivatedNodeId address invalid`)
    if (LiberdusFlags.VerboseLogs) console.log('validateClaimRewardTx fail tx.deactivatedNodeId address invalid', tx)
    response.success = false
    response.reason = 'Invalid deactivatedNodeId'
    throw new Error(response.reason)
  }
  if (!tx.nominator || tx.nominator === '' || tx.nominator.length !== 64) {
    nestedCountersInstance.countEvent('liberdus-staking', `validateClaimRewardTx fail tx.nominator address invalid`)
    if (LiberdusFlags.VerboseLogs) console.log('validateClaimRewardTx fail tx.nominator address invalid', tx)
    response.success = false
    response.reason = 'Invalid nominator address'
    throw new Error(response.reason)
  }
  if (tx.nodeDeactivatedTime <= 0) {
    nestedCountersInstance.countEvent('liberdus-staking', `validateClaimRewardTx fail tx.duration <= 0`)
    if (LiberdusFlags.VerboseLogs) console.log('validateClaimRewardTx fail tx.duration <= 0', tx)
    response.success = false
    response.reason = 'Invalid duration'
    throw new Error(response.reason)
  }
  if (tx.timestamp <= 0) {
    nestedCountersInstance.countEvent('liberdus-staking', `validateClaimRewardTx fail tx.timestamp <= 0`)
    if (LiberdusFlags.VerboseLogs) console.log('validateClaimRewardTx fail tx.timestamp <= 0', tx)
    response.success = false
    response.reason = 'Invalid timestamp'
    throw new Error(response.reason)
  }
  if (dapp.getNode(tx.deactivatedNodeId)) {
    nestedCountersInstance.countEvent('liberdus-staking', `validateClaimRewardTx fail node still active`)
    if (LiberdusFlags.VerboseLogs) console.log('validateClaimRewardTx fail node still active', tx)
    response.success = false
    response.reason = 'Node is still active'
    throw new Error(response.reason)
  }
  if (!tx.sign || !tx.sign.owner || !tx.sign.sig) {
    response.success = false
    response.reason = 'tx is not signed'
    throw new Error(response.reason)
  }
  const isValid = crypto.verifyObj(tx, true)
  if (!isValid) {
    nestedCountersInstance.countEvent('liberdus-staking', `validateClaimRewardTx fail invalid signature`)
    if (LiberdusFlags.VerboseLogs) console.log('validateClaimRewardTx fail invalid signature', tx)
    response.success = false
    response.reason = 'Invalid signature'
    throw new Error(response.reason)
  }
  if (LiberdusFlags.VerboseLogs) console.log('validateClaimRewardTx success', tx)
  nestedCountersInstance.countEvent('liberdus-staking', `validateClaimRewardTx success`)
  response.success = true
  return response
}

export const validate = (tx: Tx.ClaimRewardTX, wrappedStates: WrappedStates, response: ShardusTypes.IncomingTransactionResult, dapp: Shardus) => {
  if (LiberdusFlags.VerboseLogs) console.log('validating claimRewardTX', tx)
  const nodeAccount = wrappedStates[tx.nominee].data as NodeAccount
  // TODO: make sure this is a valid node account
  const operatorAccount = wrappedStates[tx.nominator].data as UserAccount
  // TODO: make sure this is a valid user account
  // check if the rewardStartTime is negative
  if (nodeAccount.rewardStartTime < 0) {
    nestedCountersInstance.countEvent('liberdus-staking', `validateClaimRewardState fail rewardStartTime < 0`)
    if (LiberdusFlags.VerboseLogs) console.log('validateClaimRewardState fail rewardStartTime < 0', tx)
    response.reason = 'rewardStartTime is less than 0'
    return response
  }
  // check if nodeAccount.rewardEndTime is already set to tx.nodeDeactivatedTime
  if (nodeAccount.rewardEndTime >= tx.nodeDeactivatedTime) {
    nestedCountersInstance.countEvent('liberdus-staking', `validateClaimRewardState fail rewardEndTime already set`)
    if (LiberdusFlags.VerboseLogs) console.log('validateClaimRewardState fail rewardEndTime already set', tx)
    response.reason = 'rewardEndTime is already set'
    return response
  }
  if (nodeAccount.nominator !== tx.nominator) {
    nestedCountersInstance.countEvent('liberdus-staking', `validateClaimRewardState fail tx.nominator does not match`)
    if (LiberdusFlags.VerboseLogs) console.log('validateClaimRewardState fail tx.nominator does not match', tx)
    response.reason = 'tx.nominator does not match'
    return response
  }

  const durationInNetwork = tx.nodeDeactivatedTime - nodeAccount.rewardStartTime
  if (durationInNetwork < 0) {
    nestedCountersInstance.countEvent('liberdus-staking', `applyClaimRewardTx fail durationInNetwork < 0`)
    if (LiberdusFlags.VerboseLogs) console.log('applyClaimRewardTx fail durationInNetwork < 0', tx)
    response.reason = 'applyClaimReward failed because durationInNetwork is less than 0'
    return response
  }

  if (LiberdusFlags.VerboseLogs) console.log('validateClaimRewardState success', tx)
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (
  tx: Tx.ClaimRewardTX,
  txTimestamp: number,
  txId: string,
  wrappedStates: WrappedStates,
  dapp: Shardus,
  applyResponse: ShardusTypes.ApplyResponse,
): void => {
  if (LiberdusFlags.VerboseLogs) console.log(`Running applyClaimRewardTx`, tx, wrappedStates)
  const nodeAccount = wrappedStates[tx.nominee].data as NodeAccount
  const operatorAccount = wrappedStates[tx.nominator].data as UserAccount
  const network = AccountsStorage.cachedNetworkAccount

  const currentRate = network.current.nodeRewardAmountUsd
  const rate = nodeAccount.rewardRate > currentRate ? nodeAccount.rewardRate : currentRate
  const nodeRewardAmount = scaleByStabilityFactor(rate, AccountsStorage.cachedNetworkAccount)
  const nodeRewardInterval = BigInt(network.current.nodeRewardInterval)

  let durationInNetwork = tx.nodeDeactivatedTime - nodeAccount.rewardStartTime

  // special case for seed nodes:
  // they have 0 rewardStartTime and will not be rewarded but the claim tx should still be applied
  if (nodeAccount.rewardStartTime === 0) {
    nestedCountersInstance.countEvent('liberdus-staking', `seed node claim reward ${nodeAccount.id}`)
    durationInNetwork = 0
  }

  nodeAccount.rewardEndTime = tx.nodeDeactivatedTime

  // we multiply fist then devide to preserve precision
  let rewardedAmount = nodeRewardAmount * BigInt(durationInNetwork * 1000) // Convert from seconds to milliseconds
  //update total reward var so it can be logged
  rewardedAmount = rewardedAmount / nodeRewardInterval
  //re-parse reward since it was saved as hex
  //add the reward because nodes can cycle without unstaking
  nodeAccount.reward = nodeAccount.reward + rewardedAmount
  nodeAccount.timestamp = txTimestamp

  // update the node account historical stats
  nodeAccount.nodeAccountStats.totalReward = nodeAccount.nodeAccountStats.totalReward + rewardedAmount
  nodeAccount.nodeAccountStats.history.push({
    b: nodeAccount.rewardStartTime,
    e: nodeAccount.rewardEndTime,
  })

  // update the operator historical stats
  operatorAccount.operatorAccountInfo.operatorStats.history.push({
    b: nodeAccount.rewardStartTime,
    e: nodeAccount.rewardEndTime,
  })
  operatorAccount.operatorAccountInfo.operatorStats.totalNodeReward = operatorAccount.operatorAccountInfo.operatorStats.totalNodeReward + rewardedAmount
  operatorAccount.operatorAccountInfo.operatorStats.totalNodeTime += durationInNetwork

  operatorAccount.operatorAccountInfo.operatorStats.lastStakedNodeKey = operatorAccount.operatorAccountInfo.nominee

  operatorAccount.timestamp = txTimestamp
  if (LiberdusFlags.VerboseLogs)
    console.log(
      `Calculating node reward. nodeRewardAmount: ${nodeRewardAmount}, nodeRewardInterval: ${network.current.nodeRewardInterval} ms, uptime duration: ${durationInNetwork} sec, rewardedAmount: ${rewardedAmount}, finalReward: ${nodeAccount.reward}   nodeAccount.rewardEndTime:${nodeAccount.rewardEndTime}  nodeAccount.rewardStartTime:${nodeAccount.rewardStartTime} `,
    )

  const appReceiptData: AppReceiptData = {
    txId: txId,
    timestamp: txTimestamp,
    success: true,
    type: tx.type,
    from: tx.nominee,
    to: tx.nominator,
    transactionFee: BigInt(0),
    additionalInfo: {
      nodeStartTime: nodeAccount.rewardStartTime,
      nodeEndTime: nodeAccount.rewardEndTime,
      rewardedAmount,
    },
  }

  dapp.applyResponseAddReceiptData(applyResponse, appReceiptData, txId)

  nestedCountersInstance.countEvent('liberdus-staking', `Applied ClaimRewardTX`)
  if (logFlags.dapp_verbose) dapp.log('Applied ClaimRewardTX', tx.nominee)
}

export const keys = (tx: Tx.ClaimRewardTX, result: TransactionKeys) => {
  result.sourceKeys = [tx.nominee]
  result.targetKeys = [tx.nominator]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}

export const memoryPattern = (tx: Tx.ClaimRewardTX, result: TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  return {
    rw: [tx.nominee, tx.nominator],
    wo: [],
    on: [],
    ri: [],
    ro: [],
  }
}

export const createRelevantAccount = (dapp: Shardus, account: UserAccount | NodeAccount, accountId: string, tx: Tx.ClaimRewardTX, accountCreated = false) => {
  if (!account) {
    throw new Error('Account must already exist in order to perform the claim_reward transaction')
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}
