import { nestedCountersInstance, Shardus, ShardusTypes } from '@shardus/core'
import { logFlags } from '@shardus/core/dist/logger'
import { LiberdusFlags } from '../../config'
import {
  NodeAccount,
  ViolationType,
  Tx,
  WrappedStates,
  UserAccount,
  LeftNetworkEarlyViolationData,
  NodeRefutedViolationData,
  SyncingTimeoutViolationData,
  TransactionKeys,
  AppReceiptData,
} from '../../@types'
import * as AccountsStorage from '../../storage/accountStorage'
import { _sleep, generateTxId, scaleByStabilityFactor } from '../../utils'
import * as crypto from '../../crypto'
import { TXTypes } from '..'

const penaltyTxsMap: Map<string, Tx.PenaltyTX> = new Map()

export async function injectPenaltyTX(
  dapp: Shardus,
  eventData: ShardusTypes.ShardusEvent,
  violationData: LeftNetworkEarlyViolationData | NodeRefutedViolationData | SyncingTimeoutViolationData,
): Promise<{
  success: boolean
  reason: string
  status: number
}> {
  let violationType: ViolationType
  if (eventData.type === 'node-left-early') violationType = ViolationType.LeftNetworkEarly
  else if (eventData.type === 'node-refuted') violationType = ViolationType.NodeRefuted
  else if (eventData.type === 'node-sync-timeout') violationType = ViolationType.SyncingTooLong
  const unsignedTx = {
    type: TXTypes.apply_penalty,
    reportedNodeId: eventData.nodeId,
    reportedNodePublickKey: eventData.publicKey,
    timestamp: dapp.shardusGetTime(),
    violationType,
    violationData,
  } as Tx.PenaltyTX

  const wrapeedNodeAccount: ShardusTypes.WrappedDataFromQueue = await dapp.getLocalOrRemoteAccount(unsignedTx.reportedNodePublickKey)
  if (!wrapeedNodeAccount || !wrapeedNodeAccount.data) {
    return {
      success: false,
      reason: 'Penalty Node Account not found',
      status: 404,
    }
  }
  const nodeAccount = wrapeedNodeAccount.data as NodeAccount
  // [TODO] Check if nodeAccount is a valid node account

  if (nodeAccount.nominator === '' || nodeAccount.nominator == null) {
    return {
      success: false,
      reason: 'Nominator is not set in the node account',
      status: 404,
    }
  }
  unsignedTx.nominator = nodeAccount.nominator

  // to make sure that differnt nodes all submit an equivalent unsignedTx that is counted as the same unsignedTx,
  // we need to make sure that we have a determinstic timestamp
  const cycleEndTime = eventData.time
  let futureTimestamp = cycleEndTime * 1000
  while (futureTimestamp < dapp.shardusGetTime()) {
    futureTimestamp += 30 * 1000
  }
  unsignedTx.timestamp = futureTimestamp

  const signedTx = dapp.signAsNode(unsignedTx) as Tx.PenaltyTX
  const txId = generateTxId(unsignedTx)
  // store the unsignedTx to local map for later use
  recordPenaltyTX(txId, signedTx)

  // Limit the nodes that send this to the <LiberdusFlags.numberOfNodesToInjectPenaltyTx> closest to the node address ( publicKey )
  const closestNodes = dapp.getClosestNodes(eventData.publicKey, LiberdusFlags.numberOfNodesToInjectPenaltyTx)
  const ourId = dapp.getNodeId()
  const isLuckyNode = closestNodes.some((nodeId) => nodeId === ourId)
  if (!isLuckyNode) {
    if (LiberdusFlags.VerboseLogs) console.log(`injectPenaltyTX: not lucky node, skipping injection`, signedTx)
    return { success: false, reason: 'not lucky node', status: 404 }
  }
  const waitTime = futureTimestamp - dapp.shardusGetTime()
  // since we have to pick a future timestamp, we need to wait until it is time to submit the signedTx
  await _sleep(waitTime)

  if (LiberdusFlags.VerboseLogs) {
    console.log(`injectPenaltyTX: tx.timestamp: ${signedTx.timestamp} txid: ${txId}`, signedTx)
  }

  const result = await dapp.put(signedTx)
  if (logFlags.dapp_verbose) dapp.log('INJECTED_PENALTY_TX', result)
  return result
}

export const validate_fields = (tx: Tx.PenaltyTX, response: ShardusTypes.IncomingTransactionResult) => {
  if (!tx.reportedNodeId || tx.reportedNodeId === '' || tx.reportedNodeId.length !== 64) {
    nestedCountersInstance.countEvent('liberdus-penalty', `validatePenaltyTX fail tx.reportedNode address invalid`)
    if (LiberdusFlags.VerboseLogs) console.log(`validatePenaltyTX fail tx.reportedNode address invalid`, tx)
    response.success = false
    response.reason = 'Invalid reportedNode ID'
    throw new Error(response.reason)
  }
  if (!tx.reportedNodePublickKey || tx.reportedNodePublickKey === '' || tx.reportedNodePublickKey.length !== 64) {
    nestedCountersInstance.countEvent('liberdus-penalty', `validatePenaltyTX fail tx.reportedNode publicKey invalid`)
    if (LiberdusFlags.VerboseLogs) console.log(`validatePenaltyTX fail tx.reportedNode publicKey invalid`, tx)
    response.success = false
    response.reason = 'Invalid reportedNode public key'
    throw new Error(response.reason)
  }
  if (!tx.nominator || tx.nominator === '' || tx.nominator.length !== 64) {
    nestedCountersInstance.countEvent('liberdus-penalty', `validatePenaltyTX fail tx.nominator address invalid`)
    if (LiberdusFlags.VerboseLogs) console.log(`validatePenaltyTX fail tx.nominator address invalid`, tx)
    response.success = false
    response.reason = 'Invalid nominator address'
    throw new Error(response.reason)
  }
  if (tx.violationType < ViolationType.LiberdusMinID || tx.violationType > ViolationType.LiberdusMaxID) {
    nestedCountersInstance.countEvent('liberdus-penalty', `validatePenaltyTX fail tx.violationType invalid`)
    if (LiberdusFlags.VerboseLogs) console.log(`validatePenaltyTX fail tx.violationType invalid`, tx)
    response.success = false
    response.reason = 'Invalid violation type'
    throw new Error(response.reason)
  }
  if (!tx.violationData) {
    //TODO validate violation data using violation types

    nestedCountersInstance.countEvent('liberdus-penalty', `validatePenaltyTX fail tx.violationData invalid`)
    if (LiberdusFlags.VerboseLogs) console.log(`validatePenaltyTX fail tx.violationData invalid`, tx)
    response.success = false
    response.reason = 'Invalid violation data'
    throw new Error(response.reason)
  }

  if (tx.timestamp <= 0) {
    nestedCountersInstance.countEvent('liberdus-penalty', `validatePenaltyTX fail tx.timestamp invalid`)
    if (LiberdusFlags.VerboseLogs) console.log(`validatePenaltyTX fail tx.timestamp invalid`, tx)
    response.success = false
    response.reason = 'Invalid timestamp'
    throw new Error(response.reason)
  }
  if (tx.violationType === ViolationType.LeftNetworkEarly && AccountsStorage.cachedNetworkAccount.current.slashing.enableLeftNetworkEarlySlashing === false) {
    response.success = false
    response.reason = 'Left network early slashing is disabled'
    throw new Error(response.reason)
  }
  if (tx.violationType === ViolationType.SyncingTooLong && AccountsStorage.cachedNetworkAccount.current.slashing.enableSyncTimeoutSlashing === false) {
    response.success = false
    response.reason = 'Syncing timeout slashing is disabled'
    throw new Error(response.reason)
  }
  if (tx.violationType === ViolationType.NodeRefuted && AccountsStorage.cachedNetworkAccount.current.slashing.enableNodeRefutedSlashing === false) {
    response.success = false
    response.reason = 'Node refuted slashing is disabled'
    throw new Error(response.reason)
  }
  const txId = generateTxId(tx)
  // check if we have this penalty tx stored in the Map
  const preRecordedfPenaltyTX = penaltyTxsMap.get(txId)
  if (preRecordedfPenaltyTX == null) {
    return { isValid: false, reason: 'Penalty TX not found in penaltyTxsMap of exe node' }
  }
  const isValid = crypto.verifyObj(tx, true)
  if (!isValid) {
    nestedCountersInstance.countEvent('liberdus-penalty', `validatePenaltyTX fail tx.signature invalid`)
    if (LiberdusFlags.VerboseLogs) console.log(`validatePenaltyTX fail tx.signature invalid`, tx)
    response.success = false
    response.reason = 'Invalid signature'
    throw new Error(response.reason)
  }
  if (LiberdusFlags.VerboseLogs) console.log(`validatePenaltyTX success`, tx)
  nestedCountersInstance.countEvent('liberdus-penalty', `validatePenaltyTX success`)
  response.success = true
  return response
}

export const validate = (tx: Tx.PenaltyTX, wrappedStates: WrappedStates, response: ShardusTypes.IncomingTransactionResult, dapp: Shardus) => {
  if (LiberdusFlags.VerboseLogs) console.log(`validatePenaltyTX`, tx)
  const nodeAccount = wrappedStates[tx.reportedNodePublickKey].data as NodeAccount
  // TODO: make sure this is a valid node account
  const operatorAccount = wrappedStates[tx.nominator].data as UserAccount
  // TODO: make sure this is a valid user account
  if (nodeAccount.nominator !== tx.nominator) {
    nestedCountersInstance.countEvent('liberdus-penalty', `validatePenaltyTX fail tx.nominator does not match`)
    if (LiberdusFlags.VerboseLogs) console.log(`validatePenaltyTX fail tx.nominator does not match`, tx)
    response.reason = 'tx.nominator does not match'
    return response
  }

  // checking if it was already penalized?
  // Compares the event timestamp of the penalty tx with the timestamp of the last saved penalty tx
  let isProcessed = false
  let eventTime = 0
  if (tx.violationType === ViolationType.LeftNetworkEarly) {
    isProcessed = nodeAccount.nodeAccountStats.lastPenaltyTime >= (tx.violationData as LeftNetworkEarlyViolationData).nodeDroppedTime
    eventTime = (tx.violationData as LeftNetworkEarlyViolationData).nodeDroppedTime
  }
  if (tx.violationType === ViolationType.NodeRefuted) {
    isProcessed = nodeAccount.nodeAccountStats.lastPenaltyTime >= (tx.violationData as NodeRefutedViolationData).nodeRefutedTime
    eventTime = (tx.violationData as NodeRefutedViolationData).nodeRefutedTime
  }
  if (tx.violationType === ViolationType.SyncingTooLong) {
    isProcessed = nodeAccount.nodeAccountStats.lastPenaltyTime >= (tx.violationData as SyncingTimeoutViolationData).nodeDroppedTime
    eventTime = (tx.violationData as SyncingTimeoutViolationData).nodeDroppedTime
  }
  if (isProcessed) {
    if (logFlags.dapp_verbose)
      dapp.log(
        `Processed penaltyTX: for reportedNode ${tx.reportedNodePublickKey}, nominator ${tx.nominator}, violationType ${tx.violationType}, eventTime ${eventTime} vs lastPenaltyTime ${nodeAccount.nodeAccountStats.lastPenaltyTime}`,
      )
    nestedCountersInstance.countEvent('liberdus-penalty', `validatePenaltyTX fail isProcessedPenaltyTx`)
    if (LiberdusFlags.VerboseLogs) console.log(`validatePenaltyTX fail isProcessedPenaltyTx`, tx)
    response.reason = 'Penalty TX already processed'
    return response
  }
  if (LiberdusFlags.VerboseLogs) console.log(`validatePenaltyTX success`, tx)
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (
  tx: Tx.PenaltyTX,
  txTimestamp: number,
  txId: string,
  wrappedStates: WrappedStates,
  dapp: Shardus,
  applyResponse: ShardusTypes.ApplyResponse,
): void => {
  if (LiberdusFlags.VerboseLogs) console.log(`Running applyPenaltyTX`, tx, wrappedStates)
  /* eslint-disable security/detect-object-injection */
  const nodeAccount = wrappedStates[tx.reportedNodePublickKey].data as NodeAccount
  const operatorAccount = wrappedStates[tx.nominator].data as UserAccount

  let eventTime = 0
  if (tx.violationType === ViolationType.LeftNetworkEarly) {
    eventTime = (tx.violationData as LeftNetworkEarlyViolationData).nodeDroppedTime
  }
  if (tx.violationType === ViolationType.NodeRefuted) {
    eventTime = (tx.violationData as NodeRefutedViolationData).nodeRefutedTime
  }
  if (tx.violationType === ViolationType.SyncingTooLong) {
    eventTime = (tx.violationData as SyncingTimeoutViolationData).nodeDroppedTime
  }

  let penaltyAmount = getPenaltyForViolation(tx, nodeAccount.stakeLock)
  if (penaltyAmount > nodeAccount.stakeLock) penaltyAmount = nodeAccount.stakeLock

  // update operator account
  operatorAccount.operatorAccountInfo.stake -= penaltyAmount
  operatorAccount.operatorAccountInfo.operatorStats.totalNodePenalty += penaltyAmount
  operatorAccount.timestamp = txTimestamp

  // update node account
  nodeAccount.stakeLock -= penaltyAmount
  nodeAccount.penalty += penaltyAmount
  nodeAccount.nodeAccountStats.totalPenalty += penaltyAmount
  nodeAccount.nodeAccountStats.penaltyHistory.push({
    type: tx.violationType,
    amount: penaltyAmount,
    timestamp: eventTime,
  })
  if (tx.violationType === ViolationType.LeftNetworkEarly && nodeAccount.rewardStartTime > 0) {
    nodeAccount.rewardEndTime = eventTime
    nodeAccount.nodeAccountStats.history.push({
      b: nodeAccount.rewardStartTime,
      e: nodeAccount.rewardEndTime,
    })
    operatorAccount.operatorAccountInfo.operatorStats.history.push({
      b: nodeAccount.rewardStartTime,
      e: nodeAccount.rewardEndTime,
    })
  }
  nodeAccount.timestamp = txTimestamp
  nodeAccount.nodeAccountStats.lastPenaltyTime = eventTime

  if (LiberdusFlags.VerboseLogs) console.log(`Calculating updated node penalty. nodePenaltyAmount: ${nodeAccount.penalty}`)

  const appReceiptData: AppReceiptData = {
    txId,
    timestamp: txTimestamp,
    success: true,
    from: tx.reportedNodePublickKey,
    to: tx.nominator,
    type: tx.type,
    transactionFee: BigInt(0),
    additionalInfo: {
      penaltyAmount,
    },
  }
  if (tx.violationType === ViolationType.LeftNetworkEarly) {
    appReceiptData.additionalInfo = {
      ...appReceiptData.additionalInfo,
      nodeStartTime: nodeAccount.rewardStartTime,
      nodeEndTime: nodeAccount.rewardEndTime,
    }
  }

  dapp.applyResponseAddReceiptData(applyResponse, appReceiptData, txId)

  nestedCountersInstance.countEvent('liberdus-penalty', `Applied PenaltyTX`)
  if (logFlags.dapp_verbose) dapp.log('Applied PenaltyTX', tx.reportedNodePublickKey)
}

export const keys = (tx: Tx.PenaltyTX, result: TransactionKeys) => {
  result.sourceKeys = [tx.reportedNodePublickKey]
  result.targetKeys = [tx.nominator]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}

export const memoryPattern = (tx: Tx.PenaltyTX, result: TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  return {
    rw: [tx.reportedNodePublickKey, tx.nominator],
    wo: [],
    on: [],
    ri: [],
    ro: [],
  }
}

export const createRelevantAccount = (dapp: Shardus, account: UserAccount | NodeAccount, accountId: string, tx: Tx.PenaltyTX, accountCreated = false) => {
  if (!account) {
    throw new Error('Account must already exist in order to perform the apply_penalty transaction')
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}

function recordPenaltyTX(txId: string, tx: Tx.PenaltyTX): void {
  if (penaltyTxsMap.has(txId) === false) {
    penaltyTxsMap.set(txId, tx)
  }
}

export function clearOldPenaltyTxs(dapp: Shardus): void {
  if (penaltyTxsMap.size === 0) {
    nestedCountersInstance.countEvent('liberdus-penalty', `clearOldPenaltyTxs mapSize:0`)
    return
  }
  let deleteCount = 0
  nestedCountersInstance.countEvent('liberdus-penalty', `clearOldPenaltyTxs mapSize:${penaltyTxsMap.size}`)
  const now = dapp.shardusGetTime()
  for (const [txId, tx] of penaltyTxsMap.entries()) {
    const cycleDuration = dapp.config.p2p.cycleDuration * 1000
    if (now - tx.timestamp > 5 * cycleDuration) {
      penaltyTxsMap.delete(txId)
      deleteCount++
    }
  }
  nestedCountersInstance.countEvent('liberdus-penalty', `clearOldPenaltyTxs deleteCount: ${deleteCount}`)
}

export function isLowStake(nodeAccount: NodeAccount): boolean {
  /**
   * IMPORTANT FUTURE TO-DO =:
   * This function's logic needs to be updated once `stakeRequiredUsd` actually represents
   * USD value rather than SHM.
   */

  const stakeRequiredUSD = AccountsStorage.cachedNetworkAccount.current.stakeRequiredUsd
  const lowStakeThresholdUSD = (stakeRequiredUSD * BigInt(LiberdusFlags.lowStakePercent * 100)) / BigInt(100)
  const lowStakeThreshold = scaleByStabilityFactor(lowStakeThresholdUSD, AccountsStorage.cachedNetworkAccount)

  return nodeAccount.stakeLock < lowStakeThreshold
}

export function getPenaltyForViolation(tx: Tx.PenaltyTX, stakeLock: bigint): bigint {
  const cachedNetworkAccount = AccountsStorage.cachedNetworkAccount
  switch (tx.violationType) {
    case ViolationType.LeftNetworkEarly:
      return (stakeLock * BigInt(cachedNetworkAccount.current.slashing.leftNetworkEarlyPenaltyPercent * 100)) / BigInt(100) // 20% of stakeLock
    case ViolationType.NodeRefuted:
      return (stakeLock * BigInt(cachedNetworkAccount.current.slashing.nodeRefutedPenaltyPercent * 100)) / BigInt(100) // 20% of stakeLock
    case ViolationType.SyncingTooLong:
      return (stakeLock * BigInt(cachedNetworkAccount.current.slashing.syncTimeoutPenaltyPercent * 100)) / BigInt(100) // 20% of stakeLock
    case ViolationType.DoubleVote:
      throw new Error('Violation type: ' + tx.violationType + ' Not implemented')
    default:
      throw new Error('Unexpected violation type: ' + tx.violationType)
  }
}
