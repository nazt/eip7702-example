const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

/**
 * Simplified EIP-7702 transaction test
 * 
 * This script attempts a much simpler EIP-7702 transaction to diagnose
 * network compatibility issues
 */
const main = async () => {
  // Initialize accounts
  const authorityAccount = new ethers.Wallet(process.env.PRIVATE_KEY, ethers.provider);
  const sponsorAccount = new ethers.Wallet(process.env.PRIVATE_KEY_2, ethers.provider);

  console.log("Authority address:", authorityAccount.address);
  console.log("Sponsor address:", sponsorAccount.address);

  // Get the actual chain ID from the network we're connected to
  const { chainId } = await ethers.provider.getNetwork();
  console.log(`Chain ID: ${chainId} (${ethers.toBeHex(chainId)})`);

  // Read deployment info from JSON file for the current network
  const deploymentPath = path.join(__dirname, '../deployments', `${network.name}.json`);
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment file not found for network: ${network.name}`);
  }
  
  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  const BATCH_CALL_DELEGATION_ADDRESS = deploymentInfo.contractAddress;
  
  console.log(`Using BatchCallDelegation at: ${BATCH_CALL_DELEGATION_ADDRESS}`);

  // Check if we can deploy a normal transaction first to verify network connectivity
  console.log("\nTesting standard transaction first...");
  try {
    const tx = await authorityAccount.sendTransaction({
      to: sponsorAccount.address,
      value: ethers.parseEther("0.0001")
    });
    console.log("✅ Standard transaction successful:", tx.hash);
    await tx.wait();
    console.log("Standard transaction confirmed!");
  } catch (error) {
    console.error("❌ Standard transaction failed:", error.message);
    throw new Error("Cannot proceed with EIP-7702 test if standard transactions fail");
  }

  console.log("\nProceeding with EIP-7702 test...");
  
  // Get standard transaction info
  const authorityNonce = await ethers.provider.getTransactionCount(authorityAccount.address);
  const sponsorNonce = await ethers.provider.getTransactionCount(sponsorAccount.address);
  
  console.log(`Authority nonce: ${authorityNonce}`);
  console.log(`Sponsor nonce: ${sponsorNonce}`);

  // Try normal approach first (using current nonce)
  const testNonce = authorityNonce;
  console.log(`Using authorization nonce: ${testNonce}`);

  // Create authorization data
  const authorizationData = {
    chainId: ethers.toBeHex(chainId),
    address: BATCH_CALL_DELEGATION_ADDRESS,
    nonce: ethers.toBeHex(testNonce),
  }

  // Encode and sign authorization
  const encodedAuthorizationData = ethers.concat([
    '0x05', // MAGIC code for EIP7702
    ethers.encodeRlp([
      authorizationData.chainId,
      authorizationData.address,
      authorizationData.nonce,
    ])
  ]);

  const authorizationDataHash = ethers.keccak256(encodedAuthorizationData);
  const authorizationSignature = authorityAccount.signingKey.sign(authorizationDataHash);

  // Store signature components
  authorizationData.yParity = authorizationSignature.yParity == 0 ? '0x' : '0x01';
  authorizationData.r = authorizationSignature.r;
  authorizationData.s = authorizationSignature.s;

  // Get gas prices
  const feeData = await ethers.provider.getFeeData();
  let gasPrice, maxPriorityFeePerGas, maxFeePerGas;
  
  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    maxFeePerGas = feeData.maxFeePerGas;
  } else {
    gasPrice = feeData.gasPrice || ethers.parseUnits("10", "gwei");
    maxPriorityFeePerGas = gasPrice;
    maxFeePerGas = gasPrice;
  }

  // Define the simplest possible transaction
  const txData = [
    authorizationData.chainId, // chain ID
    ethers.toBeHex(sponsorNonce), // sponsor nonce
    ethers.toBeHex(maxPriorityFeePerGas), // tip
    ethers.toBeHex(maxFeePerGas), // max fee
    ethers.toBeHex(100000), // gas limit
    sponsorAccount.address, // sponsor address pays for gas
    '0x', // no value 
    '0x', // empty calldata (no contract call)
    [], // access list (empty)
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

  // Encode transaction 
  const encodedTxData = ethers.concat([
    '0x04', // Transaction type for EIP-7702
    ethers.encodeRlp(txData)
  ]);

  // Sponsor signs the transaction
  const txDataHash = ethers.keccak256(encodedTxData);
  const txSignature = sponsorAccount.signingKey.sign(txDataHash);

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

  console.log("Sending simplified EIP-7702 transaction...");
  
  try {
    // Send the raw transaction to the network
    const tx = await ethers.provider.send('eth_sendRawTransaction', [signedTx]);
    console.log('✅ EIP-7702 transaction sent:', tx);
  } catch (error) {
    console.error("❌ EIP-7702 transaction failed:", error.message);
    
    // Check if error suggests EIP-7702 is not supported
    if (error.message.includes("decode") || error.message.includes("invalid") || 
        error.message.includes("unknown") || error.message.includes("unsupported")) {
      console.log("\n⚠️ NETWORK COMPATIBILITY ISSUE: It appears this network does not support EIP-7702 yet");
      console.log("EIP-7702 is a relatively new standard and many networks haven't implemented it yet.");
      console.log("Try using a network that explicitly supports EIP-7702 transactions.");
    }
    
    // Save debug information
    const debugInfo = {
      chainId: chainId.toString(),
      contractAddress: BATCH_CALL_DELEGATION_ADDRESS,
      authorityNonce: authorityNonce.toString(),
      sponsorNonce: sponsorNonce.toString(),
      testNonce: testNonce.toString(),
      error: error.message,
      signedTx: signedTx
    };
    
    fs.writeFileSync('eip7702_debug.json', JSON.stringify(debugInfo, null, 2));
    console.log("Debug information saved to eip7702_debug.json");
  }
}

main().then(() => {
  console.log('EIP-7702 test completed');
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});