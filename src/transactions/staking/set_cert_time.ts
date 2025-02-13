import { nestedCountersInstance, Shardus, ShardusTypes } from '@shardus/core'
import config, { ONE_SECOND, LiberdusFlags } from '../../config'
import { getAccountWithRetry } from './query_certificate'
import { AccountQueryResponse, WrappedStates, InjectTxResponse, NodeAccount, UserAccount, Tx, TransactionKeys, AppReceiptData } from '../../@types'
import * as AccountsStorage from '../../storage/accountStorage'
import { getRandom, scaleByStabilityFactor, InjectTxToConsensor } from '../../utils'
import { Utils } from '@shardus/types'
import { logFlags } from '@shardus/core/dist/logger'
import { verifyObj } from '@shardus/crypto-utils'
import { TXTypes } from '..'

export function getCertCycleDuration(): number {
  if (AccountsStorage.cachedNetworkAccount && AccountsStorage.cachedNetworkAccount.current.certCycleDuration !== null) {
    return AccountsStorage.cachedNetworkAccount.current.certCycleDuration
  }
  return LiberdusFlags.certCycleDuration
}

export async function injectSetCertTimeTx(shardus: Shardus, publicKey: string, activeNodes: ShardusTypes.ValidatorNodeDetails[]): Promise<InjectTxResponse> {
  // Query the nodeAccount and see if it is ready before injecting setCertTime
  const accountQueryResponse = (await getAccountWithRetry(publicKey, activeNodes)) as AccountQueryResponse
  if (!accountQueryResponse.success) return accountQueryResponse

  const nodeAccountQueryResponse = accountQueryResponse.account as NodeAccount
  console.log('nodeAccountQueryResponse', nodeAccountQueryResponse)
  const nominator = nodeAccountQueryResponse.nominator

  if (!nominator) {
    /* prettier-ignore */ if (logFlags.dapp_verbose) console.log(`Nominator for this node account ${publicKey} is not found!`)
    return { success: false, reason: `Nominator for this node account ${publicKey} is not found!` }
  }
  // TODO: I think we can add another validation here that checks that nominator stakeAmount has enough for minStakeRequired in the network

  // Inject the setCertTime Tx
  const randomConsensusNode: ShardusTypes.ValidatorNodeDetails = getRandom(activeNodes, 1)[0]
  let tx = {
    type: TXTypes.set_cert_time,
    nominee: publicKey,
    nominator,
    duration: getCertCycleDuration(), //temp setting to 20 to make debugging easier
    timestamp: shardus.shardusGetTime(),
  } as Tx.SetCertTime
  tx = shardus.signAsNode(tx)
  const result = await InjectTxToConsensor([randomConsensusNode], tx)
  /* prettier-ignore */ if (logFlags.dapp_verbose) console.log('INJECTED_SET_CERT_TIME_TX', result, tx)
  return result
}

export const validate_fields = (tx: Tx.SetCertTime, response: ShardusTypes.IncomingTransactionResult) => {
  if (!tx.nominee || tx.nominee.length !== 64) {
    response.success = false
    response.reason = 'Invalid nominee address'
    throw new Error(response.reason)
  }
  if (!tx.nominator || tx.nominator.length !== 64) {
    response.success = false
    response.reason = 'Invalid nominator address'
    throw new Error(response.reason)
  }
  if (tx.duration <= 0) {
    response.success = false
    response.reason = 'Duration in cert tx must be > 0'
    throw new Error(response.reason)
  }
  if (tx.duration > getCertCycleDuration()) {
    response.success = false
    response.reason = 'Duration in cert tx must be not greater than certCycleDuration'
    throw new Error(response.reason)
  }
  if (tx.timestamp <= 0) {
    response.success = false
    response.reason = 'Timestamp in cert tx must be > 0'
    throw new Error(response.reason)
  }
  if (!tx.sign || !tx.sign.owner || !tx.sign.sig || tx.sign.owner !== tx.nominee) {
    response.success = false
    response.reason = 'not signed by nominee account'
    throw new Error(response.reason)
  }
  if (!verifyObj(tx)) {
    response.success = false
    response.reason = 'Invalid signature for SetCertTime tx'
    throw new Error(response.reason)
  }
  return response
}

export const validate = (tx: Tx.SetCertTime, wrappedStates: WrappedStates, response: ShardusTypes.IncomingTransactionResult, dapp: Shardus) => {
  let committedStake = BigInt(0)

  const operatorAccount = wrappedStates[tx.nominator].data as UserAccount
  /* prettier-ignore */ if (logFlags.dapp_verbose) console.log('validateSetCertTime', tx, operatorAccount)
  if (operatorAccount == undefined) {
    response.reason = `Found no wrapped state for operator account ${tx.nominator}`
    return response
  }
  if (operatorAccount.operatorAccountInfo == null) {
    /* prettier-ignore */ nestedCountersInstance.countEvent('liberdus-staking', 'validateSetCertTime' + ' Operator account info is null')
    response.reason = `Operator account info is null: ${Utils.safeStringify(operatorAccount)}`
    return response
  }
  if (operatorAccount.type !== 'UserAccount') {
    response.reason = `Operator account type is not UserAccount: ${Utils.safeStringify(operatorAccount)}`
    return response
  }

  committedStake = operatorAccount.operatorAccountInfo.stake
  const minStakeRequiredUsd = AccountsStorage.cachedNetworkAccount.current.stakeRequiredUsd
  const minStakeRequired = scaleByStabilityFactor(minStakeRequiredUsd, AccountsStorage.cachedNetworkAccount)

  if (LiberdusFlags.VerboseLogs)
    console.log('validate operator stake', committedStake, minStakeRequired, ' committedStake < minStakeRequired : ', committedStake < minStakeRequired)
  if (committedStake < minStakeRequired) {
    response.reason = `Operator account stake is too low: ${Utils.safeStringify(operatorAccount)}`
    return response
  }
  response.success = true
  response.reason = 'This transaction is valid!'
  return response
}

export const apply = (
  tx: Tx.SetCertTime,
  txTimestamp: number,
  txId: string,
  wrappedStates: WrappedStates,
  dapp: Shardus,
  applyResponse: ShardusTypes.ApplyResponse,
): void => {
  /* prettier-ignore */ if (logFlags.dapp_verbose) console.log(`applySetCertTimeTx txTimestamp:${txTimestamp}   tx.timestamp:${tx.timestamp}`, tx)

  const operatorAccount = wrappedStates[tx.nominator].data as UserAccount
  /* prettier-ignore */ if (logFlags.dapp_verbose) console.log('operatorAccount Before', operatorAccount)
  // Update state
  const serverConfig = config.server
  let shouldChargeTxFee = true
  const certExp = operatorAccount.operatorAccountInfo.certExp

  if (certExp > 0) {
    const certStartTimestamp = certExp - getCertCycleDuration() * ONE_SECOND * serverConfig.p2p.cycleDuration

    //use tx timestampe for a deterministic result
    const expiredPercentage = (txTimestamp - certStartTimestamp) / (certExp - certStartTimestamp)

    /* prettier-ignore */ if (logFlags.dapp_verbose) console.log(`applySetCertTimeTx expiredPercentage: ${expiredPercentage}`)

    if (expiredPercentage >= 0.5) {
      // don't charge gas after 50% of the cert has
      // expired
      shouldChargeTxFee = false
      /* prettier-ignore */ nestedCountersInstance.countEvent('liberdus-staking', 'applySetCertTimeTx' + ' renew' + ' certExp chargeTxFee: false')
    } else {
      /* prettier-ignore */ nestedCountersInstance.countEvent('liberdus-staking', 'applySetCertTimeTx' + ' renew' +' certExp chargeTxFee: true')
    }
  }

  const duration = getCertCycleDuration()

  // update operator cert expiration
  operatorAccount.operatorAccountInfo.certExp = txTimestamp + serverConfig.p2p.cycleDuration * ONE_SECOND * duration

  // deduct tx fee if certExp is not set yet or far from expiration
  /* prettier-ignore */ if (logFlags.dapp_verbose) console.log(`applySetCertTimeTx shouldChargeTxFee: ${shouldChargeTxFee}`)

  let costTxFee = BigInt(0)
  if (shouldChargeTxFee) {
    costTxFee = scaleByStabilityFactor(BigInt(AccountsStorage.cachedNetworkAccount.current.transactionFee), AccountsStorage.cachedNetworkAccount)
    operatorAccount.data.balance = operatorAccount.data.balance - costTxFee
  }

  /* prettier-ignore */ if (logFlags.dapp_verbose) console.log('operatorAccount After', operatorAccount)

  operatorAccount.timestamp = txTimestamp

  const appReceiptData: AppReceiptData = {
    txId,
    timestamp: txTimestamp,
    success: true,
    from: tx.nominator,
    to: tx.nominee,
    type: tx.type,
    transactionFee: costTxFee,
  }

  dapp.applyResponseAddReceiptData(applyResponse, appReceiptData, txId)
  // nominator.data.transactions.push({ ...tx, txId })
  dapp.log('Applied set_cert_time tx', operatorAccount)
}

export const keys = (tx: Tx.SetCertTime, result: TransactionKeys) => {
  result.sourceKeys = [tx.nominee]
  result.targetKeys = [tx.nominator]
  result.allKeys = [...result.sourceKeys, ...result.targetKeys]
  return result
}

export const memoryPattern = (tx: Tx.SetCertTime, result: TransactionKeys): ShardusTypes.ShardusMemoryPatternsInput => {
  return {
    rw: [tx.nominee, tx.nominator],
    wo: [],
    on: [],
    ri: [],
    ro: [],
  }
}
export const createRelevantAccount = (dapp: Shardus, account: UserAccount | NodeAccount, accountId: string, tx: Tx.SetCertTime, accountCreated = false) => {
  if (!account) {
    throw new Error('Account must already exist in order to perform the set_cert_time transaction')
  }
  return dapp.createWrappedResponse(accountId, accountCreated, account.hash, account.timestamp, account)
}
