const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

/**
 * EIP-7702 Alternative Sponsored Transaction Implementation
 * 
 * This script demonstrates the abnormal transaction approach with sponsor:
 * - EOA acts as a pseudo-safe account
 * - sponsor nonce +1
 * - authority set to an extremely high nonce = 1001
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

  // Get recipient address from environment or use a default address
  const recipientAddress = process.env.RECIPIENT_ADDRESS || "0xa06b838A5c46D3736Dff107427fA0A4B43F3cc66";
  console.log(`Using recipient address: ${recipientAddress}`);

  // Define contract interface with execute function
  const batchInterface = new ethers.Interface([
    "function execute(tuple(bytes data, address to, uint256 value)[] calls)"
  ]);
    
  // Define a simple ETH transfer as the call
  const calls = [
    {
      data: "0x", // Simple ETH transfer
      to: recipientAddress,
      value: ethers.parseEther("0.0001") // Small amount to test with
    }
  ];

  // Encode the execute function call with parameters
  const calldata = batchInterface.encodeFunctionData("execute", [calls]);

  // Get nonce for sponsor who will send the transaction
  const sponsorNonce = await ethers.provider.getTransactionCount(sponsorAccount.address);
  console.log(`Sponsor nonce: ${sponsorNonce}`);

  // Using Abnormal approach with extremely high authorization nonce
  const authorizationNonce = 1001;
  console.log(`Using authorization nonce: ${authorizationNonce}`);

  // Create authorization for the user to delegate to the contract
  const authorizationData = {
    chainId: ethers.toBeHex(chainId), // Use actual chain ID from the connected network
    address: BATCH_CALL_DELEGATION_ADDRESS,
    nonce: ethers.toBeHex(authorizationNonce), // Using extremely high nonce (abnormal approach)
  }

  // Print the authorization data for debugging
  console.log("Authorization data:", {
    chainId: authorizationData.chainId,
    address: authorizationData.address,
    nonce: authorizationData.nonce
  });

  // Encode authorization data according to EIP-7702
  const encodedAuthorizationData = ethers.concat([
    '0x05', // MAGIC code for EIP7702
    ethers.encodeRlp([
      authorizationData.chainId,
      authorizationData.address,
      authorizationData.nonce,
    ])
  ]);

  console.log("Encoded authorization data:", encodedAuthorizationData);

  // Authority signs the authorization
  const authorizationDataHash = ethers.keccak256(encodedAuthorizationData);
  console.log("Authorization data hash:", authorizationDataHash);
  
  const authorizationSignature = authorityAccount.signingKey.sign(authorizationDataHash);

  // Store signature components
  authorizationData.yParity = authorizationSignature.yParity == 0 ? '0x' : '0x01';
  authorizationData.r = authorizationSignature.r;
  authorizationData.s = authorizationSignature.s;

  // Get current gas fee data from the network
  const feeData = await ethers.provider.getFeeData();
  
  // Get gas prices with fallbacks for legacy networks
  let gasPrice, maxPriorityFeePerGas, maxFeePerGas;
  
  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    // EIP-1559 network
    maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    maxFeePerGas = feeData.maxFeePerGas;
  } else {
    // Legacy network
    gasPrice = feeData.gasPrice || ethers.parseUnits("10", "gwei");
    maxPriorityFeePerGas = gasPrice;
    maxFeePerGas = gasPrice;
  }

  console.log("Gas fees:", {
    gasPrice: gasPrice ? gasPrice.toString() : "N/A (EIP-1559)",
    maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    maxFeePerGas: maxFeePerGas.toString()
  });

  // Prepare transaction data structure with sponsor as sender
  const txData = [
    authorizationData.chainId, // chain ID
    ethers.toBeHex(sponsorNonce), // sponsor nonce
    ethers.toBeHex(maxPriorityFeePerGas), // tip
    ethers.toBeHex(maxFeePerGas), // max fee
    ethers.toBeHex(1000000), // gas limit
    sponsorAccount.address, // sponsor address pays for gas
    '0x', // no additional value 
    calldata, // encoded function call
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

  // Encode transaction data with version prefix
  const encodedTxData = ethers.concat([
    '0x04', // Transaction type for EIP-7702
    ethers.encodeRlp(txData)
  ]);

  console.log("Encoded transaction data (truncated):", encodedTxData.substring(0, 66) + "...");

  // Sponsor signs the complete transaction
  const txDataHash = ethers.keccak256(encodedTxData);
  console.log("Transaction data hash:", txDataHash);
  
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

  console.log("Signed transaction created, sending to network...");
  
  try {
    // Send the raw transaction to the network
    console.log(signedTx)
    const tx = await ethers.provider.send('eth_sendRawTransaction', [signedTx]);
    console.log('✅ Alternative sponsored transaction sent:', tx);
    console.log(`Authority: ${authorityAccount.address} authorized the transaction`);
    console.log(`Sponsor: ${sponsorAccount.address} paid for the gas`);
  } catch (error) {
    console.error("❌ Error sending transaction:", error.message);
    if (error.error && error.error.message) {
      console.error("Detailed error:", error.error.message);
    }
    
    // Save debug information - Fixed to avoid BigInt serialization issues
    const debugInfo = {
      chainId: chainId.toString(),
      contractAddress: BATCH_CALL_DELEGATION_ADDRESS,
      sponsorNonce: sponsorNonce.toString(),
      authorizationNonce: authorizationNonce.toString(),
      authorizationData: {
        chainId: authorizationData.chainId,
        address: authorizationData.address,
        nonce: authorizationData.nonce,
        yParity: authorizationData.yParity,
        r: authorizationData.r,
        s: authorizationData.s
      },
      txDataHash: txDataHash,
      encodedTxDataPrefix: encodedTxData.substring(0, 200)
    };
    
    fs.writeFileSync('debug_tx_info.json', JSON.stringify(debugInfo, null, 2));
    console.log("Debug information saved to debug_tx_info.json");
    
    throw error;
  }
}

main().then(() => {
  console.log('Alternative sponsorship execution completed');
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});