import * as crypto from '../crypto'
import { Shardus, ShardusTypes } from '@shardus/core'
import * as utils from '../utils'
import create from '../accounts'
import * as config from '../config'
import {
  Accounts,
  NetworkParameters,
  UserAccount,
  NetworkAccount,
  IssueAccount,
  WrappedStates,
  ProposalAccount,
  Tx,
  TransactionKeys,
  AppReceiptData,
} from '../@types'

export const validate_fields = (tx: Tx.Proposal, response: ShardusTypes.IncomingTransactionResult) => {
  if (typeof tx.from !== 'string') {
    response.success = false
    response.reason = 'tx "from" field must be a string.'
    throw new Error(response.reason)
  }
  if (typeof tx.proposal !== 'string') {
    response.success = false
    response.reason = 'tx "proposal" field must be a string.'
    throw new Error(response.reason)
  }
  if (typeof tx.issue !== 'string') {
    response.success = false
    response.reason = 'tx "issue" field must be a string.'
    throw new Error(response.reason)
  }
  if (typeof tx.parameters !== 'object') {
    response.success = false
    response.reason = 'tx "parameters" field must be an object.'
    throw new Error(response.reason)
  }
  if (typeof tx.parameters.title !== 'string') {
    response.success = false
    response.reason = 'tx "parameter title" field must be a string.'
    throw new Error(response.reason)
  }
  if (typeof tx.parameters.description !== 'string') {
    response.success = false
    response.reason = 'tx "parameter description" field must be a string.'
    throw new Error(response.reason)
  }
  if (typeof tx.parameters.nodeRewardInterval !== 'number') {
    response.success = false
    response.reason = 'tx "parameter nodeRewardInterval" field must be a number.'
    throw new Error(response.reason)
  }
  if (typeof tx.parameters.nodeRewardAmountUsd !== 'bigint') {
    response.success = false
    response.reason = 'tx "parameter nodeRewardAmount" field must be a bigint.'
    throw new Error(response.reason)
  }
  if (typeof tx.parameters.nodePenaltyUsd !== 'bigint') {
    response.success = false
    response.reason = 'tx "parameter nodePenalty" field must be a bigint.'
    throw new Error(response.reason)
  }
  if (typeof tx.parameters.transactionFee !== 'bigint') {
    response.success = false
    response.reason = 'tx "parameter transactionFee" field must be a bigint.'
    throw new Error(response.reason)
  }
  if (typeof tx.parameters.stakeRequiredUsd !== 'bigint') {
    response.success = false
    response.reason = 'tx "parameter stakeRequired" field must be a bigint.'
    throw new Error(response.reason)
  }
  if (typeof tx.parameters.maintenanceInterval !== 'number') {
    response.success = false
    response.reason = 'tx "parameter maintenanceInterval" field must be a number.'
    throw new Error(response.reason)
  }
  if (typeof tx.parameters.maintenanceFee !== 'bigint') {
    response.success = false
    response.reason = 'tx "parameter maintenanceFee" field must be a bigint.'
    throw new Error(response.reason)
  }
  if (typeof tx.parameters.proposalFee !== 'bigint') {
    response.success = false
    response.reason = 'tx "parameter proposalFee" field must be a bigint.'
    throw new Error(response.reason)
  }
  if (typeof tx.parameters.devProposalFee !== 'bigint') {
    response.success = false
    response.reason = 'tx "parameter devProposalFee" field must be a bigint.'
    throw new Error(response.reason)
  }
  if (typeof tx.parameters.faucetAmount !== 'bigint') {
    response.success = false
    response.reason = 'tx "parameter faucetAmount" field must be a bigint.'
    throw new Error(response.reason)
  }
  if (typeof tx.parameters.transactionFee !== 'bigint') {
    response.success = false
    response.reason = 'tx "parameter defaultToll" field must be a bigint.'
    throw new Error(response.reason)
  }
  return response
}

export const validate = (tx: Tx.Proposal, wrappedStates: WrappedStates, response: ShardusTypes.IncomingTransactionResult, dapp: Shardus) => {
  const from: Accounts = wrappedStates[tx.from] && wrappedStates[tx.from].data
  const network: NetworkAccount = wrappedStates[config.networkAccount].data
  const issue: IssueAccount = wrappedStates[tx.issue] && wrappedStates[tx.issue].data
  const parameters: NetworkParameters = tx.parameters
  if (tx.sign.owner !== tx.from) {
    response.reason = 'not signed by from account'
    return response
  }
  if (crypto.verifyObj(tx) === false) {
    response.reason = 'incorrect signing'
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
  if (tx.proposal !== crypto.hash(`issue-${network.issue}-proposal-${issue.proposalCount + 1}`)) {
    response.reason = 'Must give the next issue proposalCount hash'
    return response
  }
  if (from.data.balance < network.current.proposalFee + network.current.transactionFee) {
    response.reason = 'From account has insufficient balance to submit a proposal'
    return response
  }
  if (parameters.transactionFee < 0) {
    response.reason = 'Min transaction fee permitted is 0'
    return response
  }
  if (parameters.transactionFee > 10) {
    response.reason = 'Max transaction fee permitted is 10'
    return response
  }
  if (parameters.maintenanceFee > 0.1) {
    response.reason = 'Max maintenanceFee fee permitted is 10%'
    return response
  }
  if (parameters.maintenanceFee < 0) {
    response.reason = 'Min maintenanceFee fee permitted is 0%'
    return response
  }
  if (parameters.maintenanceInterval > 1000000000000) {
    response.reason = 'Max maintenanceInterval permitted is 1000000000000'
    return response
  }
  if (parameters.maintenanceInterval < 600000) {
    response.reason = 'Min maintenanceInterval permitted is 600000 (10 minutes)'
    return response
  }
  if (parameters.nodeRewardInterval < 60000) {
    response.reason = 'Min nodeRewardInterval permitted is 60000 (1 minute)'
    return response
  }
  if (parameters.nodeRewardInterval > 900000000000) {
    response.reason = 'Max nodeRewardInterval fee permitted is 900000000000'
    return response
  }
  if (parameters.nodeRewardAmountUsd < 0) {
    response.reason = 'Min nodeRewardAmount permitted is 0 tokens'
    return response
  }
  if (parameters.nodeRewardAmountUsd > 1000000000) {
    response.reason = 'Max nodeRewardAmount permitted is 1000000000'
    return response
  }
  if (parameters.proposalFee < 0) {
    response.reason = 'Min proposalFee permitted is 0 tokens'
    return response
  }
  if (parameters.proposalFee > 1000000000) {
    response.reason = 'Max proposalFee permitted is 1000000000 tokens'
    return response
  }
  if (parameters.devProposalFee < 0) {
    response.reason = 'Min devProposalFee permitted is 0 tokens'
    return response
  }
  if (parameters.devProposalFee > 1000000000) {
    response.reason = 'Max devProposalFee permitted is 1000000000 tokens'
    return response
  }
  if (tx.timestamp < network.windows.proposalWindow[0] || tx.timestamp > network.windows.proposalWindow[1]) {
    response.reason = 'Network is not within the time window to accept proposals'
    return response
  }
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (
  tx: Tx.Proposal,
  txTimestamp: number,
  txId: string,
  wrappedStates: WrappedStates,
  dapp: Shardus,
  applyResponse: ShardusTypes.ApplyResponse,
): void => {
  const from: UserAccount = wrappedStates[tx.from].data
  const network: NetworkAccount = wrappedStates[config.networkAccount].data
  const proposal: ProposalAccount = wrappedStates[tx.proposal].data
  const issue: IssueAccount = wrappedStates[tx.issue].data

  from.data.balance -= network.current.proposalFee
  from.data.balance -= network.current.transactionFee
  from.data.balance -= utils.maintenanceAmount(txTimestamp, from, network)

  proposal.parameters = tx.parameters
  issue.proposalCount++
  proposal.number = issue.proposalCount
  issue.proposals.push(proposal.id)

  // from.data.transactions.push({ ...tx, txId })
  from.timestamp = txTimestamp
  issue.timestamp = txTimestamp
  proposal.timestamp = txTimestamp

  const appReceiptData: AppReceiptData = {
    txId,
    timestamp: txTimestamp,
    success: true,
    from: tx.from,
    // the actual txTo seems to be two accounts ( issue and proposal )
    // to: ,
    type: tx.type,
    transactionFee: BigInt(0),
  }
  dapp.applyResponseAddReceiptData(applyResponse, appReceiptData, txId)
  dapp.log('Applied proposal tx', from, issue, proposal)
}

export const transactionReceiptPass = (tx: Tx.Proposal, txId: string, wrappedStates: WrappedStates, dapp: any, applyResponse: ShardusTypes.ApplyResponse) => {
  dapp.log('PostApplied proposal tx')
}
export const keys = (tx: Tx.Proposal, result: TransactionKeys) => {
  result.sourceKeys = [tx.from]
  result.targetKeys = [tx.issue, tx.proposal, config.networkAccount]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}

export const memoryPattern = (tx: Tx.Proposal, result: TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  return {
    rw: [tx.from, tx.issue, tx.proposal],
    wo: [],
    on: [],
    ri: [],
    ro: [config.networkAccount],
  }
}

export const createRelevantAccount = (dapp: Shardus, account: UserAccount | ProposalAccount, accountId: string, tx: Tx.Proposal, accountCreated = false) => {
  if (!account) {
    if (accountId === tx.proposal) {
      account = create.proposalAccount(accountId, tx.parameters)
    } else {
      account = create.userAccount(accountId, tx.timestamp)
    }
    accountCreated = true
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}
