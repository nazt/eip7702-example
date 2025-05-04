require('@nomicfoundation/hardhat-network-helpers');
require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "prague"
    }
  },
  networks: {
    sichang: {
      url: process.env.RPC_URL
    },
  },
};
