import { UserAccount } from '../../@types'

/*
we can provide more efficient APIs like:
/account/:id/chats/:timestamp which first checks to see if 
account.data.chatTimestamp > request.timestamp and if so loops
though the chats object and returns just the ones 
where chats[address].timestamp > request.timestamp. 
Returns all chats if a timestamp is not provided.
*/

export const chats =
  (dapp) =>
  async (req, res): Promise<void> => {
    try {
      const id = req.params['id']
      const timestampStr = req.params['timestamp']
      const timestamp = Number(timestampStr) || 0
      const account = await dapp.getLocalOrRemoteAccount(id)
      if (account && account.data) {
        const userAccount = account.data as UserAccount
        const chats: { [address: string]: string } = {}
        for (const address in userAccount.data.chats) {
          if (userAccount.data.chats[address].receivedTimestamp > timestamp || timestamp === 0) {
            chats[address] = userAccount.data.chats[address].chatId
          }
        }
        res.json({ chats })
      } else {
        res.json({ error: 'No account with the given id' })
      }
    } catch (error) {
      dapp.log(error)
      res.json({ error })
    }
  }
