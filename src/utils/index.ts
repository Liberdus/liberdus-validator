import {UserAccount, NetworkAccount, IssueAccount, DevIssueAccount, DeveloperPayment, InjectTxResponse, ValidatorError} from '../@types'
import * as crypto from '@shardus/crypto-utils'
import * as configs from '../config'
import { Shardus,  ShardusTypes } from '@shardus/core'
import {shardusPostToNode} from './request'

export const maintenanceAmount = (timestamp: number, account: UserAccount, network: NetworkAccount): number => {
  let amount: number
  if (timestamp - account.lastMaintenance < network.current.maintenanceInterval) {
    amount = 0
  } else {
    amount =
      account.data.balance * (1 - Math.pow(1 - network.current.maintenanceFee, (timestamp - account.lastMaintenance) / network.current.maintenanceInterval))
    account.lastMaintenance = timestamp
  }
  if (typeof amount === 'number') return amount
  else return 0
}

export function generateTxId(tx: any): string {
  let txId: string
  if (!tx.sign) {
    txId = crypto.hashObj(tx)
  } else {
    txId = crypto.hashObj(tx, true) // compute from tx
  }
  return txId
}

export async function InjectTxToConsensor(
  randomConsensusNodes: ShardusTypes.ValidatorNodeDetails[],
  tx: ShardusTypes.OpaqueTransaction // Sign Object
): Promise<InjectTxResponse | ValidatorError> {
  const promises = []
  try {
    for (const randomConsensusNode of randomConsensusNodes) {
      const promise = shardusPostToNode<any>(randomConsensusNode, `/inject`, tx) // eslint-disable-line
      // @typescript-eslint/no-explicit-any
      promises.push(promise)
    }
    const res = await raceForSuccess(promises, 5000)
    if (!res.data.success) {
      return { success: false, reason: res.data.reason }
    }
    return res.data as InjectTxResponse
  } catch (error) {
    return { success: false, reason: (error as Error).message }
  }
}

async function raceForSuccess<
  T extends {
    data: {
      success: boolean
      reason?: string
    }
  }
>(promises: Promise<T>[], timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let unresolvedCount = promises.length
    const timer = setTimeout(() => {
      reject(new Error('Timeout: Operation did not complete within the allowed time.'))
    }, timeoutMs)

    for (const promise of promises) {
      promise
        .then((response) => {
          if (response.data.success) {
            clearTimeout(timer)
            resolve(response)
          } else {
            unresolvedCount--
            if (unresolvedCount === 0) {
              clearTimeout(timer)
              //reject(new Error('All promises failed or returned unsuccessful responses.'))
              resolve(response)
            }
          }
        })
        .catch((error) => {
          unresolvedCount--
          if (unresolvedCount === 0) {
            clearTimeout(timer)
            //reject(new Error('All promises failed or returned unsuccessful responses: ' + error))
            reject(error)
          }
        })
    }
  })
}

// HELPER METHOD TO WAIT
export async function _sleep(ms = 0): Promise<NodeJS.Timeout> {
  // @ts-ignore
  return new Promise(resolve => setTimeout(resolve, ms))
}

// NODE_REWARD TRANSACTION FUNCTION
export function nodeReward(address: string, nodeId: string, dapp: Shardus): void {
  const tx = {
    type: 'node_reward',
    nodeId: nodeId,
    from: address,
    to: process.env.PAY_ADDRESS || address,
    timestamp: Date.now(),
  }
  dapp.put(tx)
  dapp.log('GENERATED_NODE_REWARD: ', nodeId)
}

// ISSUE TRANSACTION FUNCTION
export async function generateIssue(address: string, nodeId: string, dapp: Shardus): Promise<void> {
  const account = await dapp.getLocalOrRemoteAccount(configs.networkAccount)
  const network = account.data as NetworkAccount
  const tx = {
    type: 'issue',
    nodeId,
    from: address,
    issue: crypto.hash(`issue-${network.issue}`),
    proposal: crypto.hash(`issue-${network.issue}-proposal-1`),
    timestamp: Date.now(),
  }
  dapp.put(tx)
  dapp.log('GENERATED_ISSUE: ', nodeId)
}

// DEV_ISSUE TRANSACTION FUNCTION
export async function generateDevIssue(address: string, nodeId: string, dapp: Shardus): Promise<void> {
  const account = await dapp.getLocalOrRemoteAccount(configs.networkAccount)
  const network = account.data as NetworkAccount
  const tx = {
    type: 'dev_issue',
    nodeId,
    from: address,
    devIssue: crypto.hash(`dev-issue-${network.devIssue}`),
    timestamp: Date.now(),
  }
  dapp.put(tx)
  dapp.log('GENERATED_DEV_ISSUE: ', nodeId)
}

// TALLY TRANSACTION FUNCTION
export async function tallyVotes(address: string, nodeId: string, dapp: Shardus): Promise<void> {
  console.log(`GOT TO TALLY_VOTES FN ${address} ${nodeId}`)
  try {
    const network = await dapp.getLocalOrRemoteAccount(configs.networkAccount)
    const networkAccount = network.data as NetworkAccount
    const account = await dapp.getLocalOrRemoteAccount(crypto.hash(`issue-${networkAccount.issue}`))
    if (!account) {
      await _sleep(500)
      return tallyVotes(address, nodeId, dapp)
    }
    const issue = account.data as IssueAccount
    const tx = {
      type: 'tally',
      nodeId,
      from: address,
      issue: issue.id,
      proposals: issue.proposals,
      timestamp: Date.now(),
    }
    dapp.put(tx)
    dapp.log('GENERATED_TALLY: ', nodeId)
  } catch (err) {
    dapp.log('ERR: ', err)
    await _sleep(1000)
    return tallyVotes(address, nodeId, dapp)
  }
}

// DEV_TALLY TRANSACTION FUNCTION
export async function tallyDevVotes(address: string, nodeId: string, dapp: Shardus): Promise<void> {
  try {
    const network = await dapp.getLocalOrRemoteAccount(configs.networkAccount)
    const networkAccount = network.data as NetworkAccount
    const account = await dapp.getLocalOrRemoteAccount(crypto.hash(`dev-issue-${networkAccount.devIssue}`))
    if (!account) {
      await _sleep(500)
      return tallyDevVotes(address, nodeId, dapp)
    }
    const devIssue = account.data as DevIssueAccount
    const tx = {
      type: 'dev_tally',
      nodeId,
      from: address,
      devIssue: devIssue.id,
      devProposals: devIssue.devProposals,
      timestamp: Date.now(),
    }
    dapp.put(tx)
    dapp.log('GENERATED_DEV_TALLY: ', nodeId)
  } catch (err) {
    dapp.log('ERR: ', err)
    await _sleep(1000)
    return tallyDevVotes(address, nodeId, dapp)
  }
}

// APPLY_PARAMETERS TRANSACTION FUNCTION
export async function applyParameters(address: string, nodeId: string, dapp: Shardus): Promise<void> {
  const account = await dapp.getLocalOrRemoteAccount(configs.networkAccount)
  const network = account.data as NetworkAccount
  const tx = {
    type: 'parameters',
    nodeId,
    from: address,
    issue: crypto.hash(`issue-${network.issue}`),
    timestamp: Date.now(),
  }
  dapp.put(tx)
  dapp.log('GENERATED_APPLY: ', nodeId)
}

// APPLY_DEV_PARAMETERS TRANSACTION FUNCTION
export async function applyDevParameters(address: string, nodeId: string, dapp: Shardus): Promise<void> {
  const account = await dapp.getLocalOrRemoteAccount(configs.networkAccount)
  const network = account.data as NetworkAccount
  const tx = {
    type: 'dev_parameters',
    nodeId,
    from: address,
    devIssue: crypto.hash(`dev-issue-${network.devIssue}`),
    timestamp: Date.now(),
  }
  dapp.put(tx)
  dapp.log('GENERATED_DEV_APPLY: ', nodeId)
}

// RELEASE DEVELOPER FUNDS FOR A PAYMENT
export function releaseDeveloperFunds(payment: DeveloperPayment, address: string, nodeId: string, dapp: Shardus): void {
  const tx = {
    type: 'developer_payment',
    nodeId,
    from: address,
    developer: payment.address,
    payment: payment,
    timestamp: Date.now(),
  }
  dapp.put(tx)
  dapp.log('GENERATED_DEV_PAYMENT: ', nodeId)
}

export function getAccountType(data) {
  if (data == null) {
    return 'undetermined'
  }

  if (data.type != null) {
    return data.type
  }

  //make sure this works on old accounts with no type
  if (data.alias !== undefined) {
    return 'UserAccount'
  }
  if (data.nodeRewardTime !== undefined) {
    return 'NodeAccount'
  }
  if (data.messages !== undefined) {
    return 'ChatAccount'
  }
  if (data.inbox !== undefined) {
    return 'AliasAccount'
  }
  if (data.devProposals !== undefined) {
    return 'DevIssueAccount'
  }
  if (data.proposals !== undefined) {
    return 'IssueAccount'
  }
  if (data.devWindows !== undefined) {
    return 'NetworkAccount'
  }
  if (data.totalVotes !== undefined) {
    if (data.power !== undefined) {
      return 'ProposalAccount'
    }
    if (data.payAddress !== undefined) {
      return 'DevProposalAccount'
    }
  }
  return 'undetermined'
}

export function getInjectedOrGeneratedTimestamp(timestampedTx: any, dapp: Shardus) {
  let { tx, timestampReceipt } = timestampedTx
  let txnTimestamp: number

  if (tx.timestamp) {
    txnTimestamp = tx.timestamp
    dapp.log(`Timestamp ${txnTimestamp} is extracted from the injected tx.`)
  } else if (timestampReceipt && timestampReceipt.timestamp) {
    txnTimestamp = timestampReceipt.timestamp
    dapp.log(`Timestamp ${txnTimestamp} is generated by the network nodes.`)
  }
  return txnTimestamp
}

export const isObject = (val): boolean => {
  if (val === null) {
    return false
  }
  if (Array.isArray(val)) {
    return false
  }
  return typeof val === 'function' || typeof val === 'object'
}
