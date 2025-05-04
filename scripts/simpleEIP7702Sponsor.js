// filepath: /workspaces/eip7702-example/scripts/simpleEIP7702Sponsor.js
const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

/**
 * Simple EIP-7702 Gas Sponsorship Implementation
 * 
 * This script demonstrates a minimal implementation of EIP-7702 sponsored transactions where:
 * - User (Alice) authorizes the transaction but doesn't pay gas
 * - Sponsor (Bob) pays for the gas fees
 * 
 * Similar to the Rust example:
 * - Alice signs the authorization
 * - Bob sends the transaction and pays for gas
 */
async function main() {
  console.log('Simple EIP-7702 Gas Sponsorship Example');
  console.log('=======================================');

  // 1. Set up user (Alice) and sponsor (Bob) accounts
  const alice = new ethers.Wallet(process.env.PRIVATE_KEY, ethers.provider);
  const bob = new ethers.Wallet(process.env.PRIVATE_KEY_2, ethers.provider);

  console.log(`Alice (authorizer): ${alice.address}`);
  console.log(`Bob (gas payer): ${bob.address}`);

  // 2. Get network information
  const network = await ethers.provider.getNetwork();
  console.log(`Network: ${network.name} (Chain ID: ${network.chainId})`);
  const chainIdHex = ethers.toBeHex(network.chainId);

  // 3. Load the Sponsor contract address
  const deploymentPath = path.join(__dirname, '../deployments/sichang_sponsor.json');
  if (!fs.existsSync(deploymentPath)) {
    throw new Error('Sponsor deployment file not found. Please deploy the contract first.');
  }
  
  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  const SPONSOR_CONTRACT_ADDRESS = deploymentInfo.contractAddress;
  console.log(`Sponsor contract: ${SPONSOR_CONTRACT_ADDRESS}`);

  // 4. Define contract interface and create contract instance
  const sponsorInterface = new ethers.Interface([
    "function sponsoredTransfer(address sender, address payable recipient, uint256 amount, uint256 nonce, uint8 v, bytes32 r, bytes32 s)",
    "function nonces(address) view returns (uint256)",
    "function gasSpent(address) view returns (uint256)"
  ]);
  
  const sponsorContract = new ethers.Contract(
    SPONSOR_CONTRACT_ADDRESS,
    sponsorInterface,
    ethers.provider
  );

  // 5. Get current nonce for Alice
  const aliceNonce = await sponsorContract.nonces(alice.address);
  console.log(`Alice's current nonce: ${aliceNonce}`);

  // 6. Define the recipient and amount for the transfer
  const recipient = process.env.RECIPIENT_ADDRESS || "0xa06b838A5c46D3736Dff107427fA0A4B43F3cc66";
  const amount = ethers.parseEther("0.0001");
  console.log(`Recipient: ${recipient}`);
  console.log(`Amount: ${ethers.formatEther(amount)} ETH`);

  // 7. Generate EIP-712 signature from Alice
  console.log('\nGenerating EIP-712 signature from Alice...');
  
  // Create the domain data
  const domain = {
    name: "Sponsor", 
    version: "1",
    chainId: network.chainId,
    verifyingContract: SPONSOR_CONTRACT_ADDRESS
  };
  
  // Define the typed data structure
  const types = {
    SponsoredTransfer: [
      { name: "sender", type: "address" },
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "nonce", type: "uint256" }
    ]
  };
  
  // Create the message object
  const message = {
    sender: alice.address,
    recipient: recipient,
    amount: amount,
    nonce: aliceNonce
  };
  
  // Alice signs the typed data
  const signature = await alice.signTypedData(domain, types, message);
  const sig = ethers.Signature.from(signature);
  console.log('Signature generated successfully');

  // 8. Encode the function call to sponsoredTransfer
  const calldata = sponsorInterface.encodeFunctionData("sponsoredTransfer", [
    alice.address,
    recipient,
    amount,
    aliceNonce,
    sig.v,
    sig.r,
    sig.s
  ]);
  
  // 9. Get Bob's current nonce and gas price information
  const bobNonce = await ethers.provider.getTransactionCount(bob.address);
  const feeData = await ethers.provider.getFeeData();
  
  // Handle both EIP-1559 and legacy gas pricing
  let maxPriorityFeePerGas, maxFeePerGas;
  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    maxFeePerGas = feeData.maxFeePerGas;
  } else {
    const gasPrice = feeData.gasPrice || ethers.parseUnits("10", "gwei");
    maxPriorityFeePerGas = gasPrice;
    maxFeePerGas = gasPrice;
  }
  
  console.log(`Bob's nonce: ${bobNonce}`);
  console.log(`Gas prices: max=${ethers.formatUnits(maxFeePerGas, "gwei")} gwei`);

  // 10. Create the authorization data for EIP-7702
  console.log('\nPreparing EIP-7702 transaction...');
  
  const authorizationData = {
    chainId: chainIdHex,
    address: SPONSOR_CONTRACT_ADDRESS,
    nonce: ethers.toBeHex(bobNonce),
  };
  
  // 11. Encode the authorization data per EIP-7702 spec
  const encodedAuthorizationData = ethers.concat([
    '0x05', // MAGIC code for EIP7702
    ethers.encodeRlp([
      authorizationData.chainId,
      authorizationData.address,
      authorizationData.nonce,
    ])
  ]);
  
  // 12. Alice signs the authorization data
  const authorizationDataHash = ethers.keccak256(encodedAuthorizationData);
  const authorizationSignature = alice.signingKey.sign(authorizationDataHash);
  
  // Store signature components
  authorizationData.yParity = authorizationSignature.yParity == 0 ? '0x' : '0x01';
  authorizationData.r = authorizationSignature.r;
  authorizationData.s = authorizationSignature.s;
  
  // 13. Create the EIP-7702 transaction data structure
  const gasLimit = 300000; // Gas limit for the transaction
  
  const txData = [
    chainIdHex,
    ethers.toBeHex(bobNonce),
    ethers.toBeHex(maxPriorityFeePerGas),
    ethers.toBeHex(maxFeePerGas),
    ethers.toBeHex(gasLimit),
    bob.address, // Bob pays for gas
    '0x', // No value sent with transaction
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
  
  // 14. Encode the final transaction with EIP-7702 type (0x04)
  const encodedTxData = ethers.concat([
    '0x04', // Transaction type for EIP-7702
    ethers.encodeRlp(txData)
  ]);
  
  // 15. Bob signs the complete transaction
  const txDataHash = ethers.keccak256(encodedTxData);
  const txSignature = bob.signingKey.sign(txDataHash);
  
  // 16. Create the complete signed transaction
  const signedTx = ethers.hexlify(ethers.concat([
    '0x04',
    ethers.encodeRlp([
      ...txData,
      txSignature.yParity == 0 ? '0x' : '0x01',
      txSignature.r,
      txSignature.s
    ])
  ]));
  
  console.log('Transaction signed and ready to send');
  
  try {
    // 17. Send the raw transaction to the network
    console.log('\nSending EIP-7702 transaction...');
    const txHash = await ethers.provider.send('eth_sendRawTransaction', [signedTx]);
    console.log(`✅ Transaction sent! Hash: ${txHash}`);
    
    // Save the transaction info to a file for reference
    const txInfo = {
      txHash,
      timestamp: new Date().toISOString(),
      alice: alice.address,
      bob: bob.address,
      recipient: recipient,
      amount: ethers.formatEther(amount),
      network: network.name,
      chainId: network.chainId
    };
    
    fs.writeFileSync(
      path.join(__dirname, '../simple_eip7702_tx.json'),
      JSON.stringify(txInfo, null, 2)
    );
    console.log('Transaction info saved to simple_eip7702_tx.json');
    
    // 18. Try to wait for the transaction confirmation
    try {
      console.log('\nWaiting for transaction confirmation...');
      
      // Some networks may not support waiting, so we'll use a timeout
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Transaction confirmation timeout")), 30000)
      );
      
      // Wait for receipt with timeout
      const receipt = await Promise.race([
        ethers.provider.getTransactionReceipt(txHash),
        timeoutPromise
      ]);
      
      if (receipt) {
        console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
        console.log(`Gas used: ${receipt.gasUsed}`);
        console.log(`Status: ${receipt.status === 1 ? 'Success' : 'Failed'}`);
      }
    } catch (waitError) {
      console.log("Could not get transaction confirmation:", waitError.message);
      console.log("This is expected on some networks that don't support waiting for receipts.");
    }
    
    // 19. Wait a few seconds and check updated state
    console.log('\nWaiting for blockchain state to update...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 20. Check gas spent by Alice
    const gasSpent = await sponsorContract.gasSpent(alice.address);
    console.log(`Gas spent by Alice: ${gasSpent}`);
    
    // 21. Check new nonce for Alice
    const newNonce = await sponsorContract.nonces(alice.address);
    console.log(`Alice's new nonce: ${newNonce}`);
    
    if (newNonce > aliceNonce) {
      console.log("\n✅ SUCCESS: Transaction was processed (nonce was updated)");
    } else {
      console.log("\n⚠️ WARNING: Transaction may not have been processed (nonce unchanged)");
    }
    
  } catch (error) {
    console.error("\n❌ Error sending transaction:", error.message);
    
    if (error.error && error.error.message) {
      console.error("Error details:", error.error.message);
    }
    
    // Check if the error indicates network doesn't support EIP-7702
    if (error.message.includes("decode") || 
        error.message.includes("invalid") || 
        error.message.includes("unknown") || 
        error.message.includes("unsupported")) {
      console.log("\n⚠️ NETWORK COMPATIBILITY ISSUE: This network may not support EIP-7702 yet");
      console.log("EIP-7702 is a relatively new standard and many networks haven't fully implemented it.");
      
      // Fallback to standard transaction
      console.log('\nTrying fallback approach with standard transaction...');
      try {
        const tx = await bob.sendTransaction({
          to: SPONSOR_CONTRACT_ADDRESS,
          data: calldata,
          gasLimit: gasLimit
        });
        
        console.log(`Fallback transaction sent: ${tx.hash}`);
        console.log("Note: This is NOT using EIP-7702, but a standard transaction from Bob.");
        console.log("The contract will still validate Alice's signature and execute the transfer.");
      } catch (fallbackError) {
        console.error("Fallback transaction also failed:", fallbackError.message);
      }
    }
  }
  
  console.log('\nEIP-7702 sponsorship demonstration completed');
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });