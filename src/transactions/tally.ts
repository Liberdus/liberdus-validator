import * as crypto from '../crypto'
import { Shardus, ShardusTypes } from '@shardus/core'
import * as config from '../config'
import create from '../accounts'
import {
  NodeAccount,
  Windows,
  OurAppDefinedData,
  UserAccount,
  NetworkAccount,
  IssueAccount,
  WrappedStates,
  ProposalAccount,
  Tx,
  TransactionKeys,
  AppReceiptData,
} from '../@types'

export const validate_fields = (tx: Tx.Tally, response: ShardusTypes.IncomingTransactionResult) => {
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
  if (typeof tx.issue !== 'string') {
    response.success = false
    response.reason = 'tx "issue" field must be a string.'
    throw new Error(response.reason)
  }
  if (!Array.isArray(tx.proposals)) {
    response.success = false
    response.reason = 'tx "proposals" field must be an array.'
    throw new Error(response.reason)
  }
  return response
}

export const validate = (tx: Tx.Tally, wrappedStates: WrappedStates, response: ShardusTypes.IncomingTransactionResult, dapp: Shardus) => {
  const network: NetworkAccount = wrappedStates[config.networkAccount].data
  const issue: IssueAccount = wrappedStates[tx.issue] && wrappedStates[tx.issue].data
  const proposals: ProposalAccount[] = tx.proposals.map((id: string) => wrappedStates[id].data)

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
  if (network.id !== config.networkAccount) {
    response.reason = 'To account must be the network account'
    return response
  }
  if (!issue) {
    response.reason = "Issue doesn't exist"
    return response
  }
  if (issue.number !== network.issue) {
    response.reason = `This issue number ${issue.number} does not match the current network issue ${network.issue}`
    return response
  }
  if (issue.active === false) {
    response.reason = 'This issue is no longer active'
    return response
  }
  if (issue.winnerId !== null) {
    response.reason = 'The winner for this issue has already been determined'
    return response
  }
  if (proposals.length !== issue.proposalCount) {
    response.reason = 'The number of proposals sent in with the transaction doesnt match the issues proposalCount'
    return response
  }
  if (tx.timestamp < network.windows.graceWindow[0] || tx.timestamp > network.windows.graceWindow[1]) {
    response.reason = 'Network is not within the time window to tally votes for proposals'
    return response
  }
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (
  tx: Tx.Tally,
  txTimestamp: number,
  txId: string,
  wrappedStates: WrappedStates,
  dapp: Shardus,
  applyResponse: ShardusTypes.ApplyResponse,
): void => {
  const from: NodeAccount = wrappedStates[tx.from].data
  const network: NetworkAccount = wrappedStates[config.networkAccount].data
  const issue: IssueAccount = wrappedStates[tx.issue].data
  const margin = 100 / (2 * (issue.proposalCount + 1)) / 100

  const defaultProposal: ProposalAccount = wrappedStates[crypto.hash(`issue-${issue.number}-proposal-1`)].data
  const sortedProposals: ProposalAccount[] = tx.proposals
    .map((id: string) => wrappedStates[id].data)
    .sort((a: ProposalAccount, b: ProposalAccount) => b.power - a.power)
  let winner = defaultProposal

  for (const proposal of sortedProposals) {
    proposal.winner = false
  }

  if (sortedProposals.length >= 2) {
    const firstPlace = sortedProposals[0]
    const secondPlace = sortedProposals[1]
    const marginToWin = secondPlace.power + margin * secondPlace.power
    if (firstPlace.power >= marginToWin) {
      winner = firstPlace
    }
  }

  winner.winner = true // CHICKEN DINNER
  const next = winner.parameters
  const nextWindows: Windows = {
    proposalWindow: [network.windows.applyWindow[1], network.windows.applyWindow[1] + config.TIME_FOR_PROPOSALS],
    votingWindow: [
      network.windows.applyWindow[1] + config.TIME_FOR_PROPOSALS,
      network.windows.applyWindow[1] + config.TIME_FOR_PROPOSALS + config.TIME_FOR_VOTING,
    ],
    graceWindow: [
      network.windows.applyWindow[1] + config.TIME_FOR_PROPOSALS + config.TIME_FOR_VOTING,
      network.windows.applyWindow[1] + config.TIME_FOR_PROPOSALS + config.TIME_FOR_VOTING + config.TIME_FOR_GRACE,
    ],
    applyWindow: [
      network.windows.applyWindow[1] + config.TIME_FOR_PROPOSALS + config.TIME_FOR_VOTING + config.TIME_FOR_GRACE,
      network.windows.applyWindow[1] + config.TIME_FOR_PROPOSALS + config.TIME_FOR_VOTING + config.TIME_FOR_GRACE + config.TIME_FOR_APPLY,
    ],
  }

  const when = txTimestamp + config.ONE_SECOND * 10
  const value = {
    type: 'apply_tally',
    timestamp: when,
    network: config.networkAccount,
    next,
    nextWindows,
  }

  const addressHash = wrappedStates[config.networkAccount].stateId
  const ourAppDefinedData = applyResponse.appDefinedData as OurAppDefinedData

  ourAppDefinedData.globalMsg = { address: config.networkAccount, addressHash, value, when, source: from.id }

  issue.winnerId = winner.id
  issue.tallied = true

  from.timestamp = txTimestamp
  issue.timestamp = txTimestamp
  winner.timestamp = txTimestamp

  const appReceiptData: AppReceiptData = {
    txId,
    timestamp: txTimestamp,
    success: true,
    from: tx.from,
    to: tx.issue,
    type: tx.type,
    transactionFee: BigInt(0),
  }
  dapp.applyResponseAddReceiptData(applyResponse, appReceiptData, txId)
  dapp.log('Applied tally tx', txId, issue, winner, ourAppDefinedData)
}

export const transactionReceiptPass = (tx: Tx.Tally, txId: string, wrappedStates: WrappedStates, dapp, applyResponse) => {
  // we should be careful, "wrappedStates" is only accountWrites at this point
  const issue: IssueAccount = wrappedStates[tx.issue].data
  const winnerId = issue.winnerId
  const winnerProposal: ProposalAccount = wrappedStates[winnerId]?.data
  let winner = winnerProposal

  if (winner == null) {
    dapp.log('ERROR: No winner proposal found for issue', issue, winnerId, wrappedStates)
    return
  }

  let { address, addressHash, value, when, source } = applyResponse.appDefinedData.globalMsg
  dapp.setGlobal(address, addressHash, value, when, source)
  dapp.log('PostApplied tally tx', issue, winner, value)
}

export const keys = (tx: Tx.Tally, result: TransactionKeys) => {
  result.sourceKeys = [tx.from]
  result.targetKeys = [...tx.proposals, tx.issue, config.networkAccount]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}

export const memoryPattern = (tx: Tx.Tally, result: TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  return {
    rw: [tx.from, tx.issue, ...tx.proposals],
    wo: [],
    on: [],
    ri: [],
    ro: [config.networkAccount],
  }
}

export const createRelevantAccount = (dapp: Shardus, account: NodeAccount | IssueAccount, accountId: string, tx: Tx.Tally, accountCreated = false) => {
  if (!account) {
    account = create.nodeAccount(accountId)
    accountCreated = true
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}
