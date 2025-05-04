const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

/**
 * Debug version of EIP-7702 Sponsorship Implementation
 * 
 * This script adds extensive debugging to diagnose issues with the Sponsor contract
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
  let gasPrice, maxPriorityFeePerGas, maxFeePerGas;
  
  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    maxFeePerGas = feeData.maxFeePerGas;
  } else {
    gasPrice = feeData.gasPrice || ethers.parseUnits("10", "gwei");
    maxPriorityFeePerGas = gasPrice;
    maxFeePerGas = gasPrice;
  }

  console.log(`Gas prices: ${ethers.formatUnits(feeData.gasPrice || 0, "gwei")} gwei`);

  try {
    console.log("Sending transaction from sponsor to execute sponsored transfer...");
    
    // We'll send the transaction with some value to ensure the contract has funds for transfer
    // This is critical if the contract doesn't have enough ETH to complete the transfer
    const tx = await sponsor.sendTransaction({
      to: SPONSOR_CONTRACT_ADDRESS,
      data: calldata,
      gasLimit: 1000000,
      value: amount // Send the amount needed for the transfer
    });

    console.log(`Transaction sent: ${tx.hash}`);
    console.log(`View on explorer: https://sichang.thaichain.org/tx/${tx.hash}`);
    
    try {
      console.log("Waiting for transaction confirmation...");
      const receipt = await tx.wait();
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
      console.log(`Gas used: ${receipt.gasUsed}`);
      console.log(`Transaction status: ${receipt.status === 1 ? 'Success' : 'Failed'}`);
      
      // Log full receipt for debugging
      console.log("Full receipt:", JSON.stringify(receipt, null, 2));
    } catch (waitError) {
      console.log("Transaction reverted:", waitError.message);
      
      if (waitError.receipt) {
        console.log(`Transaction included in block: ${waitError.receipt.blockNumber}`);
        console.log(`Status: ${waitError.receipt.status}`);
      }
    }
    
    // Check updated state
    console.log("Checking updated contract state...");
    
    // Wait a moment for blockchain state to update
    await new Promise(resolve => setTimeout(resolve, 5000));
    
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
  }
  
  console.log("Sponsorship execution completed with debug info");
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });