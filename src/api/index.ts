import { inject } from './inject'
import network from './network'
import issues from './issues'
import proposals from './proposals'
import accounts from './accounts'
import messages from './messages'
import debug from './debug'
import { queryCertificateEndpoint } from './staking/query-certificate'
import { debug_liberdus_flags, set_liberdus_flag } from './liberdus_flags'
import { Shardus } from '@shardus/core'
export default (dapp: Shardus) => {
  dapp.registerExternalPost('inject', inject(dapp))

  dapp.registerExternalGet('network/parameters', network.current(dapp))
  dapp.registerExternalGet('network/parameters/next', network.next(dapp))
  dapp.registerExternalGet('network/windows/all', network.windows_all(dapp))
  dapp.registerExternalGet('network/windows', network.windows(dapp))
  dapp.registerExternalGet('network/windows/dev', network.windows_dev(dapp))

  dapp.registerExternalGet('issues', issues.all(dapp))
  dapp.registerExternalGet('issues/latest', issues.latest(dapp))
  dapp.registerExternalGet('issues/count', issues.count(dapp))
  dapp.registerExternalGet('issues/dev', issues.dev_all(dapp))
  dapp.registerExternalGet('issues/dev/latest', issues.dev_latest(dapp))
  dapp.registerExternalGet('issues/dev/count', issues.dev_count(dapp))

  dapp.registerExternalGet('proposals', proposals.all(dapp))
  dapp.registerExternalGet('proposals/latest', proposals.latest(dapp))
  dapp.registerExternalGet('proposals/count', proposals.count(dapp))
  dapp.registerExternalGet('proposals/dev', proposals.dev_all(dapp))
  dapp.registerExternalGet('proposals/dev/latest', proposals.dev_latest(dapp))
  dapp.registerExternalGet('proposals/dev/count', proposals.dev_count(dapp))

  dapp.registerExternalGet('account/:id', accounts.account(dapp))
  dapp.registerExternalGet('account/:id/alias', accounts.alias(dapp))
  dapp.registerExternalGet('account/:id/balance', accounts.balance(dapp))
  dapp.registerExternalGet('account/:id/toll', accounts.toll(dapp))
  dapp.registerExternalGet('address/:name', accounts.address(dapp))
  dapp.registerExternalGet('account/:id/:friendId/toll', accounts.tollOfFriend(dapp))
  dapp.registerExternalGet('account/:id/friends', accounts.friends(dapp))
  dapp.registerExternalGet('account/:id/recentMessages', accounts.recentMessages(dapp))
  dapp.registerExternalGet('account/:id/chats/:timestamp', accounts.chats(dapp))
  // dapp.registerExternalGet('accounts', accounts.all(dapp))

  dapp.registerExternalGet('transaction/:id', accounts.transactions(dapp))

  dapp.registerExternalGet('messages/:chatId/:timestamp', messages(dapp))

  dapp.registerExternalGet('debug/dump', debug.dump(dapp))
  dapp.registerExternalPost('debug/exit', debug.exit)

  dapp.registerExternalPut('query-certificate', queryCertificateEndpoint(dapp))

  // Liberdus Flags
  dapp.registerExternalGet('debug-liberdus-flags', debug_liberdus_flags(dapp))
  dapp.registerExternalGet('debug-set-liberdus-flag', set_liberdus_flag(dapp))
}
