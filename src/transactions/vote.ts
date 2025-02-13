import * as crypto from '../crypto'
import { Shardus, ShardusTypes } from '@shardus/core'
import * as utils from '../utils'
import { Accounts, UserAccount, NetworkAccount, IssueAccount, WrappedStates, ProposalAccount, Tx, TransactionKeys, AppReceiptData } from '../@types'
import create from '../accounts'
import * as config from '../config'

export const validate_fields = (tx: Tx.Vote, response: ShardusTypes.IncomingTransactionResult) => {
  if (typeof tx.from !== 'string') {
    response.success = false
    response.reason = 'tx "from" field must be a string.'
    throw new Error(response.reason)
  }
  if (typeof tx.amount !== 'bigint') {
    response.success = false
    response.reason = 'tx "amount" field must be a bigint.'
    throw new Error(response.reason)
  }
  if (tx.amount < BigInt(1)) {
    response.success = false
    response.reason = 'Minimum voting "amount" allowed is 1 token'
    throw new Error(response.reason)
  }
  if (typeof tx.issue !== 'string') {
    response.success = false
    response.reason = 'tx "issue" field must be a string.'
    throw new Error(response.reason)
  }
  if (typeof tx.proposal !== 'string') {
    response.success = false
    response.reason = 'tx "proposal" field must be a string.'
    throw new Error(response.reason)
  }
  return response
}

export const validate = (tx: Tx.Vote, wrappedStates: WrappedStates, response: ShardusTypes.IncomingTransactionResult, dapp: Shardus) => {
  const from: Accounts = wrappedStates[tx.from] && wrappedStates[tx.from].data
  const network: NetworkAccount = wrappedStates[config.networkAccount].data
  const proposal: ProposalAccount = wrappedStates[tx.proposal] && wrappedStates[tx.proposal].data
  const issue: IssueAccount = wrappedStates[tx.issue] && wrappedStates[tx.issue].data

  if (tx.sign.owner !== tx.from) {
    response.reason = 'not signed by from account'
    return response
  }
  if (crypto.verifyObj(tx) === false) {
    response.reason = 'incorrect signing'
    return response
  }
  if (!issue) {
    response.reason = "issue doesn't exist"
    return response
  }
  if (issue.number !== network.issue) {
    response.reason = `This issue number ${issue.number} does not match the current network issue ${network.issue}`
    return response
  }
  if (issue.active === false) {
    response.reason = 'issue no longer active'
    return response
  }
  if (!proposal) {
    response.reason = "Proposal doesn't exist"
    return response
  }
  if (tx.amount <= 0) {
    response.reason = 'Must send tokens to vote'
    return response
  }
  if (from.data.balance < tx.amount + network.current.transactionFee) {
    response.reason = 'From account has insufficient balance to cover the amount sent in the transaction'
    return response
  }
  if (tx.timestamp < network.windows.votingWindow[0] || tx.timestamp > network.windows.votingWindow[1]) {
    response.reason = 'Network is not within the time window to accept votes'
    return response
  }
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (
  tx: Tx.Vote,
  txTimestamp: number,
  txId: string,
  wrappedStates: WrappedStates,
  dapp: Shardus,
  applyResponse: ShardusTypes.ApplyResponse,
): void => {
  const from: UserAccount = wrappedStates[tx.from].data
  const network: NetworkAccount = wrappedStates[config.networkAccount].data
  const proposal: ProposalAccount = wrappedStates[tx.proposal].data
  from.data.balance -= tx.amount
  const transactionFee = network.current.transactionFee
  const maintenanceFee = utils.maintenanceAmount(txTimestamp, from, network)
  from.data.balance -= transactionFee + maintenanceFee
  proposal.power += Number(tx.amount)
  proposal.totalVotes++

  // from.data.transactions.push({ ...tx, txId })
  from.timestamp = txTimestamp
  proposal.timestamp = txTimestamp

  const appReceiptData: AppReceiptData = {
    txId,
    timestamp: txTimestamp,
    success: true,
    from: tx.from,
    to: tx.proposal,
    type: tx.type,
    transactionFee,
    additionalInfo: {
      maintenanceFee,
    },
  }
  dapp.applyResponseAddReceiptData(applyResponse, appReceiptData, txId)
  dapp.log('Applied vote tx', from, proposal)
}

export const keys = (tx: Tx.Vote, result: TransactionKeys) => {
  result.sourceKeys = [tx.from]
  result.targetKeys = [tx.issue, tx.proposal, config.networkAccount]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}

export const memoryPattern = (tx: Tx.Vote, result: TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  const memoryPattern: ShardusTypes.ShardusMemoryPatternsInput = {
    rw: [tx.from, tx.proposal, tx.issue],
    wo: [],
    on: [],
    ri: [],
    ro: [config.networkAccount],
  }
  return memoryPattern
}

export const createRelevantAccount = (dapp: Shardus, account: UserAccount, accountId: string, tx: Tx.Vote, accountCreated = false) => {
  if (!account) {
    throw new Error('Account must already exist for the vote transaction')
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}
