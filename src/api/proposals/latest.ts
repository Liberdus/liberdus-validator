import * as configs from '../../config'
import * as crypto from 'shardus-crypto-utils'

export const latest = dapp => async (req, res): Promise<void> => {
  try {
    const network = await dapp.getLocalOrRemoteAccount(configs.networkAccount)
    const issue = await dapp.getLocalOrRemoteAccount(crypto.hash(`issue-${network.data.issue}`))
    const proposalCount = issue && issue.data.proposalCount
    const proposals = []
    for (let i = 1; i <= proposalCount; i++) {
      const proposal = await dapp.getLocalOrRemoteAccount(crypto.hash(`issue-${network.data.issue}-proposal-${i}`))
      if (proposal && proposal.data) {
        proposals.push(proposal.data)
      }
    }
    res.json({ proposals })
  } catch (error) {
    dapp.log(error)
    res.json({ error })
  }
}
