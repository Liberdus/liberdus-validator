import * as configs from '../../config'

export const toll = dapp => async (req, res): Promise<void> => {
  try {
    const id = req.params['id']
    const account = await dapp.getLocalOrRemoteAccount(id)
    if (account) {
      if (account.data.data.toll === null) {
        const network = await dapp.getLocalOrRemoteAccount(configs.networkAccount)
        res.json({ toll: network.data.current.defaultToll })
      } else {
        res.json({ toll: account.data.data.toll })
      }
    } else {
      res.json({ error: 'No account with the given id' })
    }
  } catch (error) {
    dapp.log(error)
    res.json({ error })
  }
}
