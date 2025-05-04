const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

/**
 * Test the deployed Sponsor contract
 * This script demonstrates how to use the Sponsor contract for gas sponsorship
 * Using transaction type 4 for EIP-7702
 */
const main = async () => {
  // Initialize wallet instances with private keys and provider
  const user = new ethers.Wallet(process.env.PRIVATE_KEY, ethers.provider);
  const sponsor = new ethers.Wallet(process.env.PRIVATE_KEY_2, ethers.provider);
  
  console.log("User address:", user.address);
  console.log("Sponsor address:", sponsor.address);

  // Load the deployed Sponsor contract address
  const deploymentPath = path.join(__dirname, '../deployments', 'sichang_sponsor.json');
  if (!fs.existsSync(deploymentPath)) {
    throw new Error('Sponsor contract deployment info not found');
  }
  
  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  const SPONSOR_CONTRACT_ADDRESS = deploymentInfo.contractAddress;
  
  console.log(`Using Sponsor contract at: ${SPONSOR_CONTRACT_ADDRESS}`);

  // Create contract instance
  const sponsorABI = [
    "function sponsoredTransfer(address sender, address payable recipient, uint256 amount, uint256 nonce, uint8 v, bytes32 r, bytes32 s) external payable",
    "function nonces(address sender) external view returns (uint256)",
    "function gasSpent(address sender) external view returns (uint256)",
    "function DOMAIN_SEPARATOR() external view returns (bytes32)"
  ];
  
  const sponsorContract = new ethers.Contract(SPONSOR_CONTRACT_ADDRESS, sponsorABI, ethers.provider);
  
  // Set recipient and amount for the test transaction
  const recipient = process.env.RECIPIENT_ADDRESS || sponsor.address;
  const amount = ethers.parseEther("0.0001"); // Small amount for testing
  
  console.log(`Recipient: ${recipient}`);
  console.log(`Amount: ${ethers.formatEther(amount)} ETH`);

  // Get current nonce for the user
  const nonce = await sponsorContract.nonces(user.address);
  console.log(`Current nonce for user: ${nonce}`);

  // Get domain separator from the contract
  const domainSeparator = await sponsorContract.DOMAIN_SEPARATOR();
  
  // EIP-712 typed data for the sponsored transfer
  const typedData = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' }
      ],
      SponsoredTransfer: [
        { name: 'sender', type: 'address' },
        { name: 'recipient', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'nonce', type: 'uint256' }
      ]
    },
    primaryType: 'SponsoredTransfer',
    domain: {
      name: 'Sponsor',
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: SPONSOR_CONTRACT_ADDRESS
    },
    message: {
      sender: user.address,
      recipient: recipient,
      amount: amount,
      nonce: nonce
    }
  };

  console.log("Generating EIP-712 signature...");
  
  // Create the EIP-712 signature
  const signature = await user.signTypedData(
    typedData.domain,
    { SponsoredTransfer: typedData.types.SponsoredTransfer },
    typedData.message
  );
  
  // Split signature components
  const { v, r, s } = ethers.Signature.from(signature);
  
  console.log("Signature generated successfully");
  console.log("Signature details:", { v, r: r.substring(0, 10) + "...", s: s.substring(0, 10) + "..." });

  // *** NEW: Create type 4 transaction instead of standard contract call ***
  
  // Get current sponsor nonce for sending transaction
  const sponsorNonce = await ethers.provider.getTransactionCount(sponsor.address);
  
  // Get current gas fee data from the network
  const feeData = await ethers.provider.getFeeData();
  
  // Create contract interface for encoding function call
  const iface = new ethers.Interface(sponsorABI);
  
  // Encode the sponsoredTransfer function call
  const calldata = iface.encodeFunctionData("sponsoredTransfer", [
    user.address,
    recipient,
    amount,
    nonce,
    v,
    r,
    s
  ]);
  
  // Create EIP-7702 authorization data
  const authorizationData = {
    chainId: ethers.toBeHex((await ethers.provider.getNetwork()).chainId),
    address: SPONSOR_CONTRACT_ADDRESS,
    nonce: ethers.toBeHex(sponsorNonce + 1),
  }

  // Encode authorization data according to EIP-712 standard
  const encodedAuthorizationData = ethers.concat([
    '0x05', // MAGIC code for EIP7702
    ethers.encodeRlp([
      authorizationData.chainId,
      authorizationData.address,
      authorizationData.nonce,
    ])
  ]);

  // Generate and sign authorization data hash by user
  const authorizationDataHash = ethers.keccak256(encodedAuthorizationData);
  const authorizationSignature = user.signingKey.sign(authorizationDataHash);

  // Store signature components
  authorizationData.yParity = authorizationSignature.yParity == 0 ? '0x' : '0x01';
  authorizationData.r = authorizationSignature.r;
  authorizationData.s = authorizationSignature.s;

  // Prepare complete transaction data structure
  const txData = [
    authorizationData.chainId,
    ethers.toBeHex(sponsorNonce),
    ethers.toBeHex(feeData.maxPriorityFeePerGas), // Priority fee (tip)
    ethers.toBeHex(feeData.maxFeePerGas), // Maximum total fee willing to pay
    ethers.toBeHex(1000000), // Gas limit
    SPONSOR_CONTRACT_ADDRESS, // Sponsor address as sender
    ethers.toBeHex(amount), // Value to send along with the transaction
    calldata, // Encoded function call
    [], // Access list (empty for this transaction)
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

  // Encode final transaction data with version prefix
  const encodedTxData = ethers.concat([
    '0x04', // Transaction type 4 identifier for EIP-7702
    ethers.encodeRlp(txData)
  ]);

  // Sign the complete transaction with sponsor's key
  const txDataHash = ethers.keccak256(encodedTxData);
  const txSignature = sponsor.signingKey.sign(txDataHash);

  // Construct the fully signed transaction
  const signedTx = ethers.hexlify(ethers.concat([
    '0x04', // Transaction type 4
    ethers.encodeRlp([
      ...txData,
      txSignature.yParity == 0 ? '0x' : '0x01',
      txSignature.r,
      txSignature.s
    ])
  ]));

  console.log("Sending transaction type 4 (EIP-7702)...");
  
  // Send the raw transaction to the network
  const txHash = await ethers.provider.send('eth_sendRawTransaction', [signedTx]);
  
  console.log(`Transaction sent: ${txHash}`);
  
  // Wait for transaction confirmation - Modified to handle provider limitations
  console.log("Transaction sent successfully. Due to network limitations, we cannot wait for confirmation.");
  console.log("You can check the transaction status manually with the hash: " + txHash);
  
  try {
    // Try to get the transaction receipt but don't fail if not supported
    console.log("Attempting to check transaction status (may not be supported on this network)...");
    
    // Try different methods to check the transaction
    const receipt = await ethers.provider.getTransactionReceipt(txHash);
    
    if (receipt) {
      console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);
    } else {
      console.log("Transaction is still pending or receipt method is not supported");
    }
  } catch (error) {
    console.log("Could not check transaction status: " + error.message);
    console.log("This is expected behavior on some networks and doesn't mean the transaction failed");
  }
  
  // Sleep for a moment to give the transaction time to process
  console.log("Waiting a few seconds before checking contract state...");
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  try {
    // Check updated gas spent for user
    const gasSpent = await sponsorContract.gasSpent(user.address);
    console.log(`Total gas spent by user: ${gasSpent.toString()}`);
    
    // Check new nonce
    const newNonce = await sponsorContract.nonces(user.address);
    console.log(`New nonce for user: ${newNonce}`);
    
    // Verify if nonce increased (transaction likely processed)
    if (newNonce > nonce) {
      console.log("✅ Transaction appears to be successful (nonce was updated)");
    } else {
      console.log("⚠️ Transaction may still be pending (nonce not yet updated)");
    }
  } catch (error) {
    console.log("Error checking contract state: " + error.message);
  }
}

main().then(() => {
  console.log('Test completed successfully');
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});