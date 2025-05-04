// filepath: /workspaces/eip7702-example/scripts/logEmitterEIP7702.js
const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

/**
 * EIP-7702 Example with LogEmitter
 * 
 * This script demonstrates gas sponsorship using EIP-7702 where:
 * - Alice authorizes calling emitHello() on the LogEmitter contract
 * - Bob pays for the gas fees
 * 
 * This closely follows the pattern from the Rust example
 */
async function main() {
  console.log('EIP-7702 LogEmitter Example');
  console.log('==========================');

  // 1. Set up Alice and Bob accounts
  const alice = new ethers.Wallet(process.env.PRIVATE_KEY, ethers.provider);
  const bob = new ethers.Wallet(process.env.PRIVATE_KEY_2, ethers.provider);

  console.log(`Alice (authorizer): ${alice.address}`);
  console.log(`Bob (gas payer): ${bob.address}`);

  // 2. Get network information
  const network = await ethers.provider.getNetwork();
  console.log(`Network: ${network.name} (Chain ID: ${network.chainId})`);
  const chainIdHex = ethers.toBeHex(network.chainId);

  // 3. Load the LogEmitter contract address
  const deploymentPath = path.join(__dirname, '../deployments', `${network.name === 'unknown' ? 'sichang' : network.name}_logemitter.json`);
  if (!fs.existsSync(deploymentPath)) {
    throw new Error('LogEmitter deployment file not found. Please deploy the contract first using: npx hardhat run scripts/deployLogEmitter.js');
  }
  
  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  const LOG_EMITTER_ADDRESS = deploymentInfo.contractAddress;
  console.log(`LogEmitter contract: ${LOG_EMITTER_ADDRESS}`);

  // 4. Create contract interface and instance
  const logEmitterInterface = new ethers.Interface([
    "function emitHello()",
    "function emitWorld()"
  ]);
  
  const logEmitter = new ethers.Contract(
    LOG_EMITTER_ADDRESS,
    logEmitterInterface,
    ethers.provider
  );

  // 5. Encode the function call to emitHello()
  const calldata = logEmitterInterface.encodeFunctionData("emitHello");
  console.log(`Encoded calldata: ${calldata}`);
  
  // 6. Get Alice's and Bob's nonces
  const aliceNonce = await ethers.provider.getTransactionCount(alice.address);
  const bobNonce = await ethers.provider.getTransactionCount(bob.address);
  
  console.log(`Alice's nonce: ${aliceNonce}`);
  console.log(`Bob's nonce: ${bobNonce}`);

  // 7. Get gas fee information
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
  
  console.log(`Gas prices: max=${ethers.formatUnits(maxFeePerGas, "gwei")} gwei`);

  // 8. Create authorization data for EIP-7702
  console.log('\nPreparing EIP-7702 authorization...');
  
  const authorizationData = {
    chainId: chainIdHex,
    address: LOG_EMITTER_ADDRESS,
    nonce: ethers.toBeHex(aliceNonce)
  };
  
  // 9. Encode the authorization data per EIP-7702 spec
  const encodedAuthorizationData = ethers.concat([
    '0x05', // MAGIC code for EIP7702
    ethers.encodeRlp([
      authorizationData.chainId,
      authorizationData.address,
      authorizationData.nonce,
    ])
  ]);
  
  // 10. Alice signs the authorization data
  console.log('Alice signing the authorization...');
  const authorizationDataHash = ethers.keccak256(encodedAuthorizationData);
  const authorizationSignature = alice.signingKey.sign(authorizationDataHash);
  
  // Store signature components
  authorizationData.yParity = authorizationSignature.yParity == 0 ? '0x' : '0x01';
  authorizationData.r = authorizationSignature.r;
  authorizationData.s = authorizationSignature.s;
  
  // 11. Create the EIP-7702 transaction data structure
  const gasLimit = 200000; // Gas limit for the transaction
  
  const txData = [
    chainIdHex,
    ethers.toBeHex(bobNonce),
    ethers.toBeHex(maxPriorityFeePerGas),
    ethers.toBeHex(maxFeePerGas),
    ethers.toBeHex(gasLimit),
    alice.address, // From Alice's address
    '0x', // No value sent with transaction
    calldata, // Function call data to emitHello()
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
  
  // 12. Encode the final transaction with EIP-7702 type (0x04)
  const encodedTxData = ethers.concat([
    '0x04', // Transaction type for EIP-7702
    ethers.encodeRlp(txData)
  ]);
  
  // 13. Bob signs the complete transaction
  console.log('Bob signing the transaction (paying for gas)...');
  const txDataHash = ethers.keccak256(encodedTxData);
  const txSignature = bob.signingKey.sign(txDataHash);
  
  // 14. Create the complete signed transaction
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
    // 15. Send the raw transaction to the network
    console.log('\nSending EIP-7702 transaction...');
    const txHash = await ethers.provider.send('eth_sendRawTransaction', [signedTx]);
    console.log(`✅ Transaction sent! Hash: ${txHash}`);
    
    // Save the transaction info to a file for reference
    const txInfo = {
      txHash,
      timestamp: new Date().toISOString(),
      alice: alice.address,
      bob: bob.address,
      contractAddress: LOG_EMITTER_ADDRESS,
      function: "emitHello()",
      network: network.name,
      chainId: Number(network.chainId) // Convert BigInt to Number
    };
    
    fs.writeFileSync(
      path.join(__dirname, '../logemitter_eip7702_tx.json'),
      JSON.stringify(txInfo, null, 2)
    );
    console.log('Transaction info saved to logemitter_eip7702_tx.json');
    
    // 16. Try to wait for the transaction confirmation
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
        
        // Check for the Hello event
        if (receipt.logs && receipt.logs.length > 0) {
          console.log(`\n✅ Found ${receipt.logs.length} log(s) in the transaction`);
          
          // Try to parse the Hello event
          try {
            const event = logEmitterInterface.parseLog({
              topics: receipt.logs[0].topics,
              data: receipt.logs[0].data
            });
            
            if (event) {
              console.log(`Event emitted: ${event.name}`);
            }
          } catch (parseError) {
            console.log('Could not parse log as Hello event');
          }
        } else {
          console.log('⚠️ No logs found in the transaction receipt');
        }
      }
    } catch (waitError) {
      console.log("Could not get transaction confirmation:", waitError.message);
      console.log("This is expected on some networks that don't support waiting for receipts.");
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
          to: LOG_EMITTER_ADDRESS,
          data: calldata,
          gasLimit: gasLimit
        });
        
        console.log(`Fallback transaction sent: ${tx.hash}`);
        console.log("Note: This is NOT using EIP-7702, but a standard transaction from Bob.");
        console.log("This transaction will emit the Hello event but will show Bob as the sender, not Alice.");
        
        // Wait for the transaction to be mined
        try {
          const receipt = await tx.wait();
          console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
          console.log(`Gas used: ${receipt.gasUsed}`);
          console.log(`Status: ${receipt.status === 1 ? 'Success' : 'Failed'}`);
        } catch (waitError) {
          console.log("Could not wait for transaction confirmation:", waitError.message);
        }
      } catch (fallbackError) {
        console.error("Fallback transaction also failed:", fallbackError.message);
      }
    }
  }
  
  console.log('\nEIP-7702 LogEmitter demonstration completed');
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });