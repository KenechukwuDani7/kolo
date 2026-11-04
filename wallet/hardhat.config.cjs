// Local fork of Base Sepolia so the spike runs against the real deployed
// Coinbase Smart Wallet factory and SpendPermissionManager without testnet funds.
module.exports = {
  networks: {
    hardhat: {
      chainId: 84532,
      hardfork: 'cancun',
      forking: { url: process.env.FORK_URL || 'https://sepolia.base.org' },
      chains: {
        84532: { hardforkHistory: { cancun: 0 } },
      },
    },
  },
}
