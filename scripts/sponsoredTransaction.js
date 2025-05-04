const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

/**
 * EIP-7702 Sponsorship Pattern Implementation
 * 
 * This script demonstrates account X paying for transaction gas fees on behalf of account Y.
 * - User (Y): Authorizes the transaction but doesn't pay gas
 * - Sponsor (X): Pays for the gas fees but doesn't need to authorize
 */
const main = async () => {
  // User is the transaction originator who authorizes the action
  const user = new ethers.Wallet(process.env.PRIVATE_KEY, ethers.provider);
  // Sponsor is the account that pays for gas fees
  const sponsor = new ethers.Wallet(process.env.PRIVATE_KEY_2, ethers.provider);

  console.log("User address (authorizer):", user.address);
  console.log("Sponsor address (gas payer):", sponsor.address);

  // Read deployment info from JSON file
  const deploymentPath = path.join(__dirname, '../deployments', `${network.name}.json`);
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment file not found for network: ${network.name}`);
  }
  
  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  const BATCH_CALL_DELEGATION_ADDRESS = deploymentInfo.contractAddress;
  
  console.log(`Using BatchCallDelegation at: ${BATCH_CALL_DELEGATION_ADDRESS}`);

  // Get the chain ID from the network
  const { chainId } = await ethers.provider.getNetwork();
  console.log(`Chain ID: ${chainId}`);
  const chainIdHex = ethers.toBeHex(chainId);
  
  // Define contract interface with execute function signature
  const batchInterface = new ethers.Interface([
    "function execute(tuple(bytes data, address to, uint256 value)[] calls)"
  ]);
    
  // Define the transaction payload that user wants to execute
  const calls = [
    {
      data: "0x",
      to: process.env.RECIPIENT_ADDRESS || sponsor.address, // Fallback to sponsor address if not specified
      value: ethers.parseEther("0.001")
    }
  ];

  // Encode the execute function call with parameters
  const calldata = batchInterface.encodeFunctionData("execute", [calls]);

  // Get nonce for sponsor who will send the transaction
  const sponsorNonce = await ethers.provider.getTransactionCount(sponsor.address);
  console.log(`Sponsor nonce: ${sponsorNonce}`);

  // Create authorization for the user to delegate to the contract
  const authorizationData = {
    chainId: chainIdHex, // Chain ID from network in hex
    address: BATCH_CALL_DELEGATION_ADDRESS, // Contract that will be delegated to
    nonce: ethers.toBeHex(sponsorNonce), // Using the sponsor's current nonce
  }

  console.log("Authorization data:", {
    chainId: authorizationData.chainId,
    address: authorizationData.address,
    nonce: authorizationData.nonce
  });

  // Encode authorization data 
  const encodedAuthorizationData = ethers.concat([
    '0x05', // MAGIC code for EIP7702
    ethers.encodeRlp([
      authorizationData.chainId,
      authorizationData.address, 
      authorizationData.nonce,
    ])
  ]);

  console.log("Encoded authorization data:", encodedAuthorizationData);

  // USER signs the authorization (key to sponsorship)
  const authorizationDataHash = ethers.keccak256(encodedAuthorizationData);
  console.log("Authorization data hash:", authorizationDataHash);
  const authorizationSignature = user.signingKey.sign(authorizationDataHash);

  // Store signature components
  authorizationData.yParity = authorizationSignature.yParity == 0 ? '0x' : '0x01';
  authorizationData.r = authorizationSignature.r;
  authorizationData.s = authorizationSignature.s;

  // Get current gas fee data from the network
  const feeData = await ethers.provider.getFeeData();
  
  // Use legacy gas pricing if EIP-1559 fees not available
  const gasPrice = feeData.gasPrice || ethers.parseUnits("10", "gwei");
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || gasPrice;
  const maxFeePerGas = feeData.maxFeePerGas || gasPrice;

  console.log("Fee data:", {
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    maxFeePerGas: maxFeePerGas.toString()
  });

  // Prepare transaction data structure with sponsor as sender
  const txData = [
    authorizationData.chainId,
    ethers.toBeHex(sponsorNonce), 
    ethers.toBeHex(maxPriorityFeePerGas), 
    ethers.toBeHex(maxFeePerGas),
    ethers.toBeHex(1000000), // Gas limit
    sponsor.address, // Sponsor address (pays for gas)
    '0x', // No additional value
    calldata, // Encoded function call
    [], // Access list (empty)
    [
      [
        authorizationData.chainId,
        authorizationData.address,
        authorizationData.nonce,
        authorizationData.yParity,
        authorizationData.r,
        authorizationData.s
      ]
    ]
  ];

  // Encode transaction data with type prefix
  const encodedTxData = ethers.concat([
    '0x04', // Transaction type for EIP-7702
    ethers.encodeRlp(txData)
  ]);

  console.log("Encoded transaction data:", encodedTxData.substring(0, 66) + "...");

  // SPONSOR signs the complete transaction
  const txDataHash = ethers.keccak256(encodedTxData);
  console.log("Transaction data hash:", txDataHash);
  const txSignature = sponsor.signingKey.sign(txDataHash);

  // Construct the fully signed transaction
  const signedTx = ethers.hexlify(ethers.concat([
    '0x04',
    ethers.encodeRlp([
      ...txData,
      txSignature.yParity == 0 ? '0x' : '0x01',
      txSignature.r,
      txSignature.s
    ])
  ]));

  console.log("Signed transaction created, sending to network...");
  
  try {
    // Send the raw transaction to the network
    const tx = await ethers.provider.send('eth_sendRawTransaction', [signedTx]);
    console.log('Sponsored transaction sent: ', tx);
    console.log(`User: ${user.address} created the transaction`);
    console.log(`Sponsor: ${sponsor.address} paid for the gas`);
  } catch (error) {
    console.error("Error sending transaction:", error.message);
    // If detailed error info available, print it
    if (error.error && error.error.message) {
      console.error("Detailed error:", error.error.message);
    }
    throw error;
  }
}

main().then(() => {
  console.log('Sponsorship execution completed');
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});