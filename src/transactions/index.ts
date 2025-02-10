import * as init_network from './init_network'
import * as network_windows from './networkWindows'
import * as snapshot from './snapshot'
import * as email from './email'
import * as gossip_email_hash from './gossip_email_hash'
import * as verify from './verify'
import * as register from './register'
import * as create from './create'
import * as transfer from './transfer'
import * as distribute from './distribute'
import * as message from './message'
import * as read from './read'
import * as update_chat_toll from './update_chat_toll'
import * as reclaim_toll from './reclaim_toll'
import * as toll from './toll'
import * as friend from './friend'
import * as remove_friend from './remove_friend'
import * as stake from './stake'
import * as remove_stake from './remove_stake'
import * as remove_stake_request from './remove_stake_request'
import * as node_reward from './node_reward'
import * as snapshot_claim from './snapshot_claim'
import * as issue from './issue'
import * as proposal from './proposal'
import * as vote from './vote'
import * as tally from './tally'
import * as apply_tally from './apply_tally'
import * as parameters from './parameters'
import * as apply_parameters from './apply_parameters'
import * as dev_issue from './dev_issue'
import * as dev_proposal from './dev_proposal'
import * as dev_tally from './dev_tally'
import * as dev_vote from './dev_vote'
import * as apply_dev_tally from './apply_dev_tally'
import * as dev_parameters from './dev_parameters'
import * as apply_dev_parameters from './apply_dev_parameters'
import * as developer_payment from './developer_payment'
import * as apply_developer_payment from './apply_developer_payment'
import * as change_config from './change_config'
import * as apply_change_config from './apply_change_config'
import * as change_network_param from './change_network_param'
import * as apply_change_network_param from './apply_change_network_param'
import * as deposit_stake from './staking/deposit_stake'
import * as withdraw_stake from './staking/withdraw_stake'
import * as set_cert_time from './staking/set_cert_time'
import * as query_certificate from './staking/query_certificate'
import * as init_reward from './staking/init_reward'
import * as claim_reward from './staking/claim_reward'
import * as apply_penalty from './staking/apply_penalty'
import * as admin_certificate from './admin_certificate'

export default {
  init_network,
  network_windows,
  snapshot,
  email,
  gossip_email_hash,
  verify,
  register,
  create,
  transfer,
  distribute,
  message,
  read,
  update_chat_toll,
  reclaim_toll,
  toll,
  friend,
  remove_friend,
  stake,
  remove_stake,
  remove_stake_request,
  node_reward,
  snapshot_claim,
  issue,
  proposal,
  vote,
  tally,
  apply_tally,
  parameters,
  apply_parameters,
  dev_issue,
  dev_proposal,
  dev_vote,
  dev_tally,
  apply_dev_tally,
  dev_parameters,
  apply_dev_parameters,
  developer_payment,
  apply_developer_payment,
  change_config,
  apply_change_config,
  change_network_param,
  apply_change_network_param,
  deposit_stake,
  withdraw_stake,
  set_cert_time,
  query_certificate,
  init_reward,
  claim_reward,
  apply_penalty,
  admin_certificate,
}

export enum TXTypes {
  init_network = 'init_network',
  network_windows = 'network_windows',
  snapshot = 'snapshot',
  email = 'email',
  gossip_email_hash = 'gossip_email_hash',
  verify = 'verify',
  register = 'register',
  create = 'create',
  transfer = 'transfer',
  distribute = 'distribute',
  message = 'message',
  read = 'read',
  toll = 'toll',
  update_chat_toll = 'update_chat_toll',
  reclaim_toll = 'reclaim_toll',
  friend = 'friend',
  remove_friend = 'remove_friend',
  stake = 'stake',
  remove_stake = 'remove_stake',
  remove_stake_request = 'remove_stake_request',
  node_reward = 'node_reward',
  snapshot_claim = 'snapshot_claim',
  issue = 'issue',
  proposal = 'proposal',
  vote = 'vote',
  tally = 'tally',
  apply_tally = 'apply_tally',
  parameters = 'parameters',
  apply_parameters = 'apply_parameters',
  dev_issue = 'dev_issue',
  dev_proposal = 'dev_proposal',
  dev_vote = 'dev_vote',
  dev_tally = 'dev_tally',
  apply_dev_tally = 'apply_dev_tally',
  dev_parameters = 'dev_parameters',
  apply_dev_parameters = 'apply_dev_parameters',
  developer_payment = 'developer_payment',
  apply_developer_payment = 'apply_developer_payment',
  change_config = 'change_config',
  apply_change_config = 'apply_change_config',
  change_network_param = 'change_network_param',
  apply_change_network_param = 'apply_change_network_param',
  deposit_stake = 'deposit_stake',
  withdraw_stake = 'withdraw_stake',
  set_cert_time = 'set_cert_time',
  query_certificate = 'query_certificate',
  init_reward = 'init_reward',
  claim_reward = 'claim_reward',
  apply_penalty = 'apply_penalty',
}
