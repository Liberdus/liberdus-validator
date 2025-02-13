import * as crypto from '../crypto'
import { Shardus, ShardusTypes } from '@shardus/core'
import * as config from '../config'
import { Utils } from '@shardus/types'
import create from '../accounts'
import {
  DevIssueAccount,
  DevProposalAccount,
  NodeAccount,
  OurAppDefinedData,
  DevWindows,
  DeveloperPayment,
  NetworkAccount,
  WrappedStates,
  Tx,
  TransactionKeys,
  AppReceiptData,
} from '../@types'

export const validate_fields = (tx: Tx.DevTally, response: ShardusTypes.IncomingTransactionResult) => {
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
  if (typeof tx.devIssue !== 'string') {
    response.success = false
    response.reason = 'tx "devIssue" field must be a string.'
    throw new Error(response.reason)
  }
  if (!Array.isArray(tx.devProposals)) {
    response.success = false
    response.reason = 'tx "devProposals" field must be an array.'
    throw new Error(response.reason)
  }
  return response
}

export const validate = (tx: Tx.DevTally, wrappedStates: WrappedStates, response: ShardusTypes.IncomingTransactionResult, dapp: Shardus) => {
  const network: NetworkAccount = wrappedStates[config.networkAccount].data
  const devIssue: DevIssueAccount = wrappedStates[tx.devIssue] && wrappedStates[tx.devIssue].data
  const devProposals: DevProposalAccount[] = tx.devProposals.map((id: string) => wrappedStates[id].data)

  // let nodeInfo
  // try {
  //   nodeInfo = dapp.getNode(tx.nodeId)
  // } catch (err) {
  //   dapp.log(err)
  // }
  // if (!nodeInfo) {
  //   response.reason = 'no nodeInfo'
  //   return response
  // }
  if (!devIssue) {
    response.reason = "devIssue doesn't exist"
    return response
  }
  if (devIssue.number !== network.devIssue) {
    response.reason = `This devIssue number ${devIssue.number} does not match the current network issue ${network.devIssue}`
    return response
  }
  if (devIssue.active === false) {
    response.reason = 'This devIssue is no longer active'
    return response
  }
  if (Array.isArray(devIssue.winners) && devIssue.winners.length > 0) {
    response.reason = `The winners for this devIssue has already been determined ${Utils.safeStringify(devIssue.winners)}`
    return response
  }
  if (network.id !== config.networkAccount) {
    response.reason = 'To account must be the network account'
    return response
  }
  if (devProposals.length !== devIssue.devProposalCount) {
    response.reason = `The number of devProposals sent in with the transaction ${devProposals.length} doesn't match the devIssue proposalCount ${devIssue.devProposalCount}`
    return response
  }
  if (tx.timestamp < network.devWindows.devGraceWindow[0] || tx.timestamp > network.devWindows.devGraceWindow[1]) {
    response.reason = 'Network is not within the time window to tally votes for developer proposals'
    return response
  }
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (
  tx: Tx.DevTally,
  txTimestamp: number,
  txId: string,
  wrappedStates: WrappedStates,
  dapp: Shardus,
  applyResponse: ShardusTypes.ApplyResponse,
): void => {
  const from: NodeAccount = wrappedStates[tx.from].data
  const network: NetworkAccount = wrappedStates[config.networkAccount].data
  const devIssue: DevIssueAccount = wrappedStates[tx.devIssue].data
  const devProposals: DevProposalAccount[] = tx.devProposals.map((id: string) => wrappedStates[id].data)
  let nextDeveloperFund: DeveloperPayment[] = []

  const scalingFactor = BigInt(100)
  const multiplier = BigInt(15) // Represents 0.15 as an integer
  for (const devProposal of devProposals) {
    if (devProposal.approve > devProposal.reject + (devProposal.reject * multiplier) / scalingFactor) {
      devProposal.approved = true
      const payments = []
      for (const payment of devProposal.payments) {
        payments.push({
          timestamp: txTimestamp + config.TIME_FOR_DEV_GRACE + payment.delay,
          delay: payment.delay,
          amount: payment.amount * devProposal.totalAmount,
          address: devProposal.payAddress,
          id: crypto.hashObj(payment),
        })
      }
      nextDeveloperFund = [...nextDeveloperFund, ...payments]
      devProposal.timestamp = txTimestamp
      devIssue.winners.push(devProposal.id)
    } else {
      devProposal.approved = false
      devProposal.timestamp = txTimestamp
    }
  }

  const nextDevWindows: DevWindows = {
    devProposalWindow: [network.devWindows.devApplyWindow[1], network.devWindows.devApplyWindow[1] + config.TIME_FOR_DEV_PROPOSALS],
    devVotingWindow: [
      network.devWindows.devApplyWindow[1] + config.TIME_FOR_DEV_PROPOSALS,
      network.devWindows.devApplyWindow[1] + config.TIME_FOR_DEV_PROPOSALS + config.TIME_FOR_DEV_VOTING,
    ],
    devGraceWindow: [
      network.devWindows.devApplyWindow[1] + config.TIME_FOR_DEV_PROPOSALS + config.TIME_FOR_DEV_VOTING,
      network.devWindows.devApplyWindow[1] + config.TIME_FOR_DEV_PROPOSALS + config.TIME_FOR_DEV_VOTING + config.TIME_FOR_DEV_GRACE,
    ],
    devApplyWindow: [
      network.devWindows.devApplyWindow[1] + config.TIME_FOR_DEV_PROPOSALS + config.TIME_FOR_DEV_VOTING + config.TIME_FOR_DEV_GRACE,
      network.devWindows.devApplyWindow[1] + config.TIME_FOR_DEV_PROPOSALS + config.TIME_FOR_DEV_VOTING + config.TIME_FOR_DEV_GRACE + config.TIME_FOR_DEV_APPLY,
    ],
  }

  const when = txTimestamp + config.ONE_SECOND * 10

  const value = {
    type: 'apply_dev_tally',
    timestamp: when,
    network: config.networkAccount,
    nextDeveloperFund,
    nextDevWindows,
  }

  const addressHash = wrappedStates[config.networkAccount].stateId
  const ourAppDefinedData = applyResponse.appDefinedData as OurAppDefinedData

  ourAppDefinedData.globalMsg = { address: config.networkAccount, addressHash, value, when, source: from.id }

  from.timestamp = txTimestamp
  devIssue.timestamp = txTimestamp
  devIssue.tallied = true

  const appReceiptData: AppReceiptData = {
    txId,
    timestamp: txTimestamp,
    success: true,
    from: tx.from,
    to: tx.devIssue,
    type: tx.type,
    transactionFee: BigInt(0),
  }
  dapp.applyResponseAddReceiptData(applyResponse, appReceiptData, txId)
  dapp.log('Applied dev_tally tx', devIssue, devProposals, value)
}

export const transactionReceiptPass = (tx: Tx.DevTally, txId: string, wrappedStates: WrappedStates, dapp, applyResponse) => {
  const { address, addressHash, value, when, source } = applyResponse.appDefinedData.globalMsg
  dapp.setGlobal(address, addressHash, value, when, source)
  dapp.log('PostApplied dev_tally tx', address, value, when, source)
}

export const keys = (tx: Tx.DevTally, result: TransactionKeys) => {
  result.sourceKeys = [tx.from]
  result.targetKeys = [...tx.devProposals, tx.devIssue, config.networkAccount]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}

export const memoryPattern = (tx: Tx.DevTally, result: TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  return {
    rw: [tx.from, ...tx.devProposals, tx.devIssue],
    wo: [],
    on: [],
    ri: [],
    ro: [config.networkAccount],
  }
}

export const createRelevantAccount = (dapp: Shardus, account: NodeAccount, accountId: string, tx: Tx.DevTally, accountCreated = false) => {
  if (!account) {
    account = create.nodeAccount(accountId)
    accountCreated = true
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}
