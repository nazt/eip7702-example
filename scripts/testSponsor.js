const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

/**
 * This script demonstrates using EIP-7702 for sponsored transactions
 * with the Sponsor contract, where the user authorizes a transaction
 * but the sponsor pays for gas.
 */
async function main() {
  // Set up user wallet (authorizer) and sponsor wallet (gas payer)
  const user = new ethers.Wallet(process.env.PRIVATE_KEY, ethers.provider);
  const sponsor = new ethers.Wallet(process.env.PRIVATE_KEY_2, ethers.provider);

  console.log("User address:", user.address);
  console.log("Sponsor address:", sponsor.address);

  // Read the Sponsor contract deployment information
  const deploymentPath = path.join(__dirname, '../deployments', 'sichang_sponsor.json');
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Sponsor deployment file not found for network: sichang`);
  }
  
  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  const SPONSOR_CONTRACT_ADDRESS = deploymentInfo.contractAddress;
  
  console.log(`Using Sponsor contract at: ${SPONSOR_CONTRACT_ADDRESS}`);

  // Define recipient and amount for the sponsored transfer
  const recipient = process.env.RECIPIENT_ADDRESS || "0xa06b838A5c46D3736Dff107427fA0A4B43F3cc66";
  const amount = ethers.parseEther("0.0001");
  
  console.log(`Recipient: ${recipient}`);
  console.log(`Amount: ${ethers.formatEther(amount)} ETH`);

  // Create interface for Sponsor contract
  const sponsorInterface = new ethers.Interface([
    "function sponsoredTransfer(address sender, address payable recipient, uint256 amount, uint256 nonce, uint8 v, bytes32 r, bytes32 s)",
    "function nonces(address) view returns (uint256)",
    "function gasSpent(address) view returns (uint256)"
  ]);

  // Create contract instance for reading data
  const sponsorContract = new ethers.Contract(
    SPONSOR_CONTRACT_ADDRESS,
    sponsorInterface,
    ethers.provider
  );

  // Get current nonce for the user
  const currentNonce = await sponsorContract.nonces(user.address);
  console.log(`Current nonce for user: ${currentNonce}`);

  // Create domain data for EIP-712 signature
  console.log("Generating EIP-712 signature...");
  const domain = {
    name: "Sponsor",
    version: "1",
    chainId: await ethers.provider.getNetwork().then(n => n.chainId),
    verifyingContract: SPONSOR_CONTRACT_ADDRESS
  };

  // Define the types for EIP-712 structured data
  const types = {
    SponsoredTransfer: [
      { name: "sender", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "uint256" }
    ]
  };

  // Create the message to sign
  const message = {
    sender: user.address,
    recipient: recipient,
    amount: amount,
    nonce: currentNonce
  };

  // Sign the typed data using EIP-712
  const signature = await user.signTypedData(domain, types, message);
  console.log("Signature generated successfully");

  // Get the signature components (v, r, s)
  const sig = ethers.Signature.from(signature);
  console.log(`Signature details: { v: ${sig.v}, r: '${sig.r.slice(0, 10)}...', s: '${sig.s.slice(0, 10)}...' }`);

  // Encode the function call to sponsoredTransfer
  const calldata = sponsorInterface.encodeFunctionData("sponsoredTransfer", [
    user.address,
    recipient,
    amount,
    currentNonce,
    sig.v,
    sig.r,
    sig.s
  ]);

  // Get current gas fee data
  const feeData = await ethers.provider.getFeeData();
  
  // Get network information
  const network = await ethers.provider.getNetwork();
  const chainIdHex = ethers.toBeHex(network.chainId);

  // Get sponsor's current nonce
  const sponsorNonce = await ethers.provider.getTransactionCount(sponsor.address);
  console.log(`Sponsor nonce: ${sponsorNonce}`);

  // Create authorization data structure for EIP-7702
  console.log("Sending transaction type 4 (EIP-7702)...");
  const authorizationData = {
    chainId: chainIdHex,
    address: SPONSOR_CONTRACT_ADDRESS,
    nonce: ethers.toBeHex(sponsorNonce),
  };

  // Encode authorization data according to EIP-712 standard
  const encodedAuthorizationData = ethers.concat([
    '0x05', // MAGIC code for EIP7702
    ethers.encodeRlp([
      authorizationData.chainId,
      authorizationData.address,
      authorizationData.nonce,
    ])
  ]);

  // Generate and sign authorization data hash with USER key
  const authorizationDataHash = ethers.keccak256(encodedAuthorizationData);
  const authorizationSignature = user.signingKey.sign(authorizationDataHash);

  // Store signature components
  authorizationData.yParity = authorizationSignature.yParity == 0 ? '0x' : '0x01';
  authorizationData.r = authorizationSignature.r;
  authorizationData.s = authorizationSignature.s;

  // Use legacy gas pricing if EIP-1559 fees not available
  const gasPrice = feeData.gasPrice || ethers.parseUnits("10", "gwei");
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || gasPrice;
  const maxFeePerGas = feeData.maxFeePerGas || gasPrice;

  // Create the EIP-7702 transaction data structure
  const txData = [
    chainIdHex,
    ethers.toBeHex(sponsorNonce),
    ethers.toBeHex(maxPriorityFeePerGas),
    ethers.toBeHex(maxFeePerGas),
    ethers.toBeHex(1000000), // Gas limit
    sponsor.address, // Sponsor address (who pays for gas)
    ethers.toBeHex(0), // No additional value sent with tx
    calldata, // Function call data
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

  // Encode the final transaction with EIP-7702 type (0x04)
  const encodedTxData = ethers.concat([
    '0x04', // Transaction type for EIP-7702
    ethers.encodeRlp(txData)
  ]);

  // Have the SPONSOR sign the complete transaction
  const txDataHash = ethers.keccak256(encodedTxData);
  const txSignature = sponsor.signingKey.sign(txDataHash);

  // Create the complete signed transaction 
  const signedTx = ethers.hexlify(ethers.concat([
    '0x04',
    ethers.encodeRlp([
      ...txData,
      txSignature.yParity == 0 ? '0x' : '0x01',
      txSignature.r,
      txSignature.s
    ])
  ]));

  // Send the raw transaction
  try {
    const txHash = await ethers.provider.send('eth_sendRawTransaction', [signedTx]);
    console.log(`Transaction sent: ${txHash}`);
    console.log("Transaction sent successfully. Due to network limitations, we cannot wait for confirmation.");
    console.log(`You can check the transaction status manually with the hash: ${txHash}`);
    
    // Try to check status, but this might not work on all networks
    console.log("Attempting to check transaction status (may not be supported on this network)...");
    try {
      const receipt = await ethers.provider.getTransactionReceipt(txHash);
      if (receipt) {
        console.log(`Transaction status: ${receipt.status === 1 ? 'Success' : 'Failed'}`);
        console.log(`Gas used: ${receipt.gasUsed}`);
      } else {
        console.log("Transaction is still pending or receipt method is not supported");
      }
    } catch (error) {
      console.log("Could not get transaction receipt:", error.message);
    }
    
    // Wait a bit before checking updated state
    console.log("Waiting a few seconds before checking contract state...");
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check gas spent by user
    const gasSpent = await sponsorContract.gasSpent(user.address);
    console.log(`Total gas spent by user: ${gasSpent}`);
    
    // Check new nonce
    const newNonce = await sponsorContract.nonces(user.address);
    console.log(`New nonce for user: ${newNonce}`);
    
    if (newNonce > currentNonce) {
      console.log("✅ Transaction appears to be successful (nonce was updated)");
    } else {
      console.log("⚠️ Transaction may have failed (nonce was not updated)");
    }
    
    console.log("Test completed successfully");
    
  } catch (error) {
    console.error("Error sending transaction:", error);
    throw error;
  }
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });