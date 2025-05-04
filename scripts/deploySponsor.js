const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

/**
 * Deploy Sponsor contract
 * This script deploys the Sponsor.sol contract to the network
 */
async function main() {
  console.log('Deploying Sponsor contract...');

  // Get the deployer account from wallet using environment variable
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, ethers.provider);
  console.log(`Deployer address: ${deployer.address}`);

  // Deploy the Sponsor contract
  const Sponsor = await ethers.getContractFactory('Sponsor', deployer);
  const sponsor = await Sponsor.deploy();
  
  // Wait for deployment to complete
  await sponsor.waitForDeployment();
  
  // Get the deployed contract address
  const sponsorAddress = await sponsor.getAddress();
  console.log(`Sponsor contract deployed to: ${sponsorAddress}`);

  // Save deployment info
  const network = await ethers.provider.getNetwork();
  const networkName = network.name === 'unknown' ? 'sichang' : network.name;
  
  const deploymentInfo = {
    contractAddress: sponsorAddress,
    deploymentTime: new Date().toISOString(),
    network: networkName,
    deployer: deployer.address
  };

  // Create deployments directory if it doesn't exist
  const deploymentsDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  // Write deployment info to file
  const deploymentPath = path.join(deploymentsDir, `${networkName}_sponsor.json`);
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