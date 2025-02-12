import * as crypto from '../crypto'
import {DevProposalAccount} from '../@types'

export const devProposalAccount = (accountId: string) => {
  const devProposal: DevProposalAccount = {
    id: accountId,
    type: 'DevProposalAccount',
    title: null,
    description: null,
    approve: BigInt(0),
    reject: BigInt(0),
    totalVotes: 0,
    totalAmount: null,
    payAddress: '',
    payments: [],
    approved: null,
    number: null,
    hash: '',
    timestamp: 0,
  }
  devProposal.hash = crypto.hashObj(devProposal)
  return devProposal
}
