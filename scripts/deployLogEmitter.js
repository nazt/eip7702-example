// filepath: /workspaces/eip7702-example/scripts/deployLogEmitter.js
const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

/**
 * Deploy LogEmitter contract
 * This script deploys the LogEmitter.sol contract to the network for EIP-7702 demonstrations
 */
async function main() {
  console.log('Deploying LogEmitter contract...');

  // Get the deployer account from wallet using environment variable
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, ethers.provider);
  console.log(`Deployer address: ${deployer.address}`);

  // Deploy the LogEmitter contract
  const LogEmitter = await ethers.getContractFactory('LogEmitter', deployer);
  const logEmitter = await LogEmitter.deploy();
  
  // Wait for deployment to complete
  await logEmitter.waitForDeployment();
  
  // Get the deployed contract address
  const logEmitterAddress = await logEmitter.getAddress();
  console.log(`LogEmitter contract deployed to: ${logEmitterAddress}`);

  // Save deployment info
  const network = await ethers.provider.getNetwork();
  const networkName = network.name === 'unknown' ? 'sichang' : network.name;
  
  const deploymentInfo = {
    contractAddress: logEmitterAddress,
    deploymentTime: new Date().toISOString(),
    network: networkName,
    chainId: Number(network.chainId), // Convert BigInt to Number to fix JSON serialization
    deployer: deployer.address
  };

  // Create deployments directory if it doesn't exist
  const deploymentsDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  // Write deployment info to file
  const deploymentPath = path.join(deploymentsDir, `${networkName}_logemitter.json`);
  fs.writeFileSync(
    deploymentPath,
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log(`Deployment info saved to: ${deploymentPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });