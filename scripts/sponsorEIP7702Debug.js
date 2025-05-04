const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

/**
 * Debug version of EIP-7702 Sponsorship Implementation
 * 
 * This script adds extensive debugging to diagnose issues with the Sponsor contract
 * using transaction type 4 (EIP-7702)
 */
async function main() {
  // Load the accounts
  const user = new ethers.Wallet(process.env.PRIVATE_KEY, ethers.provider);
  const sponsor = new ethers.Wallet(process.env.PRIVATE_KEY_2, ethers.provider);

  console.log("User address (authorizer):", user.address);
  console.log("Sponsor address (gas payer):", sponsor.address);

  // Check sponsor balance to ensure it has funds
  const sponsorBalance = await ethers.provider.getBalance(sponsor.address);
  console.log(`Sponsor balance: ${ethers.formatEther(sponsorBalance)} ETH`);

  // Check user balance (for debugging)
  const userBalance = await ethers.provider.getBalance(user.address);
  console.log(`User balance: ${ethers.formatEther(userBalance)} ETH`);

  // Load Sponsor contract address from deployment file
  const deploymentPath = path.join(__dirname, '../deployments/sichang_sponsor.json');
  if (!fs.existsSync(deploymentPath)) {
    throw new Error("Sponsor deployment file not found for sichang network");
  }
  
  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  const SPONSOR_CONTRACT_ADDRESS = deploymentInfo.contractAddress;
  
  console.log(`Using Sponsor contract at: ${SPONSOR_CONTRACT_ADDRESS}`);

  // Check contract balance
  const contractBalance = await ethers.provider.getBalance(SPONSOR_CONTRACT_ADDRESS);
  console.log(`Contract balance: ${ethers.formatEther(contractBalance)} ETH`);

  // Get network info
  const network = await ethers.provider.getNetwork();
  console.log(`Network: ${network.name} (Chain ID: ${network.chainId})`);
  const chainIdHex = ethers.toBeHex(network.chainId);
  console.log(`Chain ID (hex): ${chainIdHex}`);

  // Define recipient and amount for the sponsored transfer
  const recipient = process.env.RECIPIENT_ADDRESS || "0xa06b838A5c46D3736Dff107427fA0A4B43F3cc66";
  const amount = ethers.parseEther("0.0001");
  
  console.log(`Recipient: ${recipient}`);
  console.log(`Amount: ${ethers.formatEther(amount)} ETH`);

  // Check recipient balance (for debugging)
  const recipientBalance = await ethers.provider.getBalance(recipient);
  console.log(`Recipient balance: ${ethers.formatEther(recipientBalance)} ETH`);

  // Define Sponsor contract interface
  const sponsorInterface = new ethers.Interface([
    "function sponsoredTransfer(address sender, address payable recipient, uint256 amount, uint256 nonce, uint8 v, bytes32 r, bytes32 s)",
    "function nonces(address) view returns (uint256)",
    "function gasSpent(address) view returns (uint256)",
    "function DOMAIN_SEPARATOR() view returns (bytes32)"
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

  // Get domain separator directly from contract for verification
  const contractDomainSeparator = await sponsorContract.DOMAIN_SEPARATOR();
  console.log(`Contract domain separator: ${contractDomainSeparator}`);

  // Create domain data for EIP-712 signature
  console.log("Generating EIP-712 signature...");
  const domain = {
    name: "Sponsor",
    version: "1",
    chainId: network.chainId,
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

  // Log complete message for debugging
  console.log("Message to sign:", {
    domain,
    types,
    message
  });

  // Sign the typed data using EIP-712
  const signature = await user.signTypedData(domain, types, message);
  console.log("Signature generated successfully");

  // Get the signature components (v, r, s)
  const sig = ethers.Signature.from(signature);
  console.log(`Signature details: { v: ${sig.v}, r: '${sig.r}', s: '${sig.s}' }`);

  // Encode the function call to sponsoredTransfer with extra debugging
  console.log("Function parameters:", [
    user.address, // sender
    recipient,    // recipient
    amount,       // amount
    currentNonce, // nonce
    sig.v,        // v
    sig.r,        // r
    sig.s         // s
  ]);

  const calldata = sponsorInterface.encodeFunctionData("sponsoredTransfer", [
    user.address,
    recipient,
    amount,
    currentNonce,
    sig.v,
    sig.r,
    sig.s
  ]);

  console.log("Encoded calldata:", calldata);
  
  // Get sponsor's current nonce
  const sponsorNonce = await ethers.provider.getTransactionCount(sponsor.address);
  console.log(`Sponsor nonce: ${sponsorNonce}`);

  // Get gas fee data
  const feeData = await ethers.provider.getFeeData();
  console.log("Fee data:", {
    gasPrice: feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, "gwei") + " gwei" : "N/A",
    maxFeePerGas: feeData.maxFeePerGas ? ethers.formatUnits(feeData.maxFeePerGas, "gwei") + " gwei" : "N/A",
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ? ethers.formatUnits(feeData.maxPriorityFeePerGas, "gwei") + " gwei" : "N/A"
  });
  
  // Use legacy gas pricing if EIP-1559 fees not available
  const gasPrice = feeData.gasPrice || ethers.parseUnits("10", "gwei");
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || gasPrice;
  const maxFeePerGas = feeData.maxFeePerGas || gasPrice;

  try {
    console.log("Preparing EIP-7702 transaction (type 4)...");
    
    // Create authorization data structure for EIP-7702
    console.log("Creating authorization data for EIP-7702...");
    const authorizationData = {
      chainId: chainIdHex,
      address: SPONSOR_CONTRACT_ADDRESS,
      nonce: ethers.toBeHex(sponsorNonce),
    };
    
    console.log("Authorization data:", authorizationData);

    // Encode authorization data according to EIP-712 standard
    const encodedAuthorizationData = ethers.concat([
      '0x05', // MAGIC code for EIP7702
      ethers.encodeRlp([
        authorizationData.chainId,
        authorizationData.address,
        authorizationData.nonce,
      ])
    ]);
    
    console.log("Encoded authorization data:", encodedAuthorizationData);

    // Generate and sign authorization data hash with USER key
    const authorizationDataHash = ethers.keccak256(encodedAuthorizationData);
    console.log("Authorization data hash:", authorizationDataHash);
    
    const authorizationSignature = user.signingKey.sign(authorizationDataHash);
    console.log("Authorization signature:", {
      r: authorizationSignature.r,
      s: authorizationSignature.s,
      yParity: authorizationSignature.yParity
    });

    // Store signature components
    authorizationData.yParity = authorizationSignature.yParity == 0 ? '0x' : '0x01';
    authorizationData.r = authorizationSignature.r;
    authorizationData.s = authorizationSignature.s;

    const gasLimit = 1000000; // Gas limit
    console.log(`Using gas limit: ${gasLimit}`);

    // Create the EIP-7702 transaction data structure
    console.log("Creating EIP-7702 transaction data...");
    const txData = [
      chainIdHex,
      ethers.toBeHex(sponsorNonce),
      ethers.toBeHex(maxPriorityFeePerGas),
      ethers.toBeHex(maxFeePerGas),
      ethers.toBeHex(gasLimit),
      user.address, // Sponsor address (who pays for gas)
      ethers.toBeHex(amount), // Include value to ensure contract has enough for transfer
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
    
    console.log("Transaction data:", JSON.stringify(txData, null, 2));

    // Encode the final transaction with EIP-7702 type (0x04)
    const encodedTxData = ethers.concat([
      '0x04', // Transaction type for EIP-7702
      ethers.encodeRlp(txData)
    ]);
    
    console.log("Encoded transaction data length:", encodedTxData.length);

    // Have the SPONSOR sign the complete transaction
    console.log("Signing transaction with sponsor key...");
    const txDataHash = ethers.keccak256(encodedTxData);
    console.log("Transaction data hash:", txDataHash);
    
    const txSignature = sponsor.signingKey.sign(txDataHash);
    console.log("Transaction signature:", {
      r: txSignature.r,
      s: txSignature.s,
      yParity: txSignature.yParity
    });

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
    
    console.log("Signed transaction (first 100 chars):", signedTx.substring(0, 100) + "...");
    
    // Write the full transaction to a debug file for inspection
    fs.writeFileSync(
      path.join(__dirname, '../eip7702_debug.json'), 
      JSON.stringify({
        authorizationData,
        txData,
        signedTx
      }, null, 2)
    );
    console.log("Wrote debug data to eip7702_debug.json");

    // Send the raw transaction
    console.log("Sending EIP-7702 raw transaction...");
    const txHash = await ethers.provider.send('eth_sendRawTransaction', [signedTx]);
    console.log(`Transaction sent: ${txHash}`);
    console.log(`View on explorer: https://sichang.thaichain.org/tx/${txHash}`);
    
    // Write the transaction hash and info to a debug file
    fs.writeFileSync(
      path.join(__dirname, '../debug_tx_info.json'), 
      JSON.stringify({
        txHash,
        timestamp: new Date().toISOString(),
        network: network.name,
        chainId: network.chainId
      }, null, 2)
    );
    
    try {
      console.log("Waiting for transaction confirmation...");
      
      // Since some networks may not support waiting for confirmation, we'll use a timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Transaction confirmation timeout")), 60000)
      );
      
      // Wait for receipt with timeout
      const receipt = await Promise.race([
        ethers.provider.getTransactionReceipt(txHash),
        timeoutPromise
      ]);
      
      if (receipt) {
        console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
        console.log(`Gas used: ${receipt.gasUsed}`);
        console.log(`Transaction status: ${receipt.status === 1 ? 'Success' : 'Failed'}`);
      
        // Log full receipt for debugging
        console.log("Full receipt:", JSON.stringify(receipt, null, 2));
      }
    } catch (waitError) {
      console.log("Could not get transaction confirmation:", waitError.message);
      console.log("This is expected on some networks that don't support waiting for receipts");
    }
    
    // Check updated state
    console.log("Checking updated contract state...");
    
    // Wait a moment for blockchain state to update
    console.log("Waiting 10 seconds for blockchain state to update...");
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Check balances after transaction
    const newContractBalance = await ethers.provider.getBalance(SPONSOR_CONTRACT_ADDRESS);
    console.log(`Contract balance after: ${ethers.formatEther(newContractBalance)} ETH`);
    
    const newRecipientBalance = await ethers.provider.getBalance(recipient);
    console.log(`Recipient balance after: ${ethers.formatEther(newRecipientBalance)} ETH`);
    
    // Check if recipient balance increased
    if (newRecipientBalance > recipientBalance) {
      console.log(`✅ Recipient received ${ethers.formatEther(newRecipientBalance - recipientBalance)} ETH`);
    } else {
      console.log(`❌ Recipient balance did not increase`);
    }
    
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
    
  } catch (error) {
    console.error("Error sending transaction:", error.message);
    
    if (error.error && error.error.message) {
      console.error("Detailed error:", error.error.message);
    }
    
    // Try to extract more information from the error
    if (error.transaction) {
      console.log("Transaction that caused the error:", error.transaction);
    }
    
    if (error.receipt) {
      console.log("Receipt from failed transaction:", error.receipt);
    }
  }
  
  console.log("EIP-7702 sponsorship execution completed with debug info");
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });