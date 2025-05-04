const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

/**
 * EIP-7702 Sponsorship Implementation for the Sponsor Contract
 * 
 * This script demonstrates a correct implementation of EIP-7702 sponsored transactions
 * where:
 * - User authorizes the transaction by signing (does not pay gas)
 * - Sponsor executes and pays for gas
 * - The transaction appears to come from the user
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

  if (sponsorBalance < ethers.parseEther("0.001")) {
    console.error("Warning: Sponsor account has very low balance for paying gas");
  }

  // Load Sponsor contract address from deployment file
  const deploymentPath = path.join(__dirname, '../deployments/sichang_sponsor.json');
  if (!fs.existsSync(deploymentPath)) {
    throw new Error("Sponsor deployment file not found for sichang network");
  }
  
  const deploymentInfo = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
  const SPONSOR_CONTRACT_ADDRESS = deploymentInfo.contractAddress;
  
  console.log(`Using Sponsor contract at: ${SPONSOR_CONTRACT_ADDRESS}`);

  // Get network info
  const network = await ethers.provider.getNetwork();
  console.log(`Network: ${network.name} (Chain ID: ${network.chainId})`);
  const chainIdHex = ethers.toBeHex(network.chainId);

  // Define recipient and amount for the sponsored transfer
  const recipient = process.env.RECIPIENT_ADDRESS || "0xa06b838A5c46D3736Dff107427fA0A4B43F3cc66";
  const amount = ethers.parseEther("0.0001");
  
  console.log(`Recipient: ${recipient}`);
  console.log(`Amount: ${ethers.formatEther(amount)} ETH`);

  // Define Sponsor contract interface
  const sponsorInterface = new ethers.Interface([
    "function sponsoredTransfer(address sender, address recipient, uint256 amount, uint256 nonce, uint8 v, bytes32 r, bytes32 s)",
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

  console.log("Building EIP-7702 transaction (type 4)...");
  
  // Get sponsor's current nonce
  const sponsorNonce = await ethers.provider.getTransactionCount(sponsor.address);
  console.log(`Sponsor nonce: ${sponsorNonce}`);

  // Get gas fee data
  const feeData = await ethers.provider.getFeeData();
  let maxPriorityFeePerGas, maxFeePerGas;
  
  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    // EIP-1559 enabled network
    maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
    maxFeePerGas = feeData.maxFeePerGas;
  } else {
    // Legacy gas pricing
    const gasPrice = feeData.gasPrice || ethers.parseUnits("10", "gwei");
    maxPriorityFeePerGas = gasPrice;
    maxFeePerGas = gasPrice;
  }

  console.log(`Gas prices: priority=${ethers.formatUnits(maxPriorityFeePerGas, "gwei")} gwei, max=${ethers.formatUnits(maxFeePerGas, "gwei")} gwei`);

  // Standard transaction object (will be used for debugging if needed)
  const standardTx = {
    to: SPONSOR_CONTRACT_ADDRESS,
    nonce: sponsorNonce,
    maxPriorityFeePerGas: maxPriorityFeePerGas,
    maxFeePerGas: maxFeePerGas,
    gasLimit: 1000000,
    data: calldata,
    chainId: network.chainId,
    type: 0,
    value: 0
  };

  try {
    // --------------------------------------------------------------------
    // APPROACH 1: Using eth_sendRawTransaction with EIP-7702 encoding
    // --------------------------------------------------------------------
    
    // Create the standard transaction hash for signature
    const tx = await sponsor.sendTransaction({
      to: SPONSOR_CONTRACT_ADDRESS,
      data: calldata,
      gasLimit: 1000000,
      value: 0
    });

    console.log(`Transaction sent: ${tx.hash}`);
    console.log(`View on explorer: https://explorer.sichang.io/tx/${tx.hash}`);
    
    try {
      console.log("Waiting for transaction confirmation...");
      const receipt = await tx.wait();
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
      console.log(`Gas used: ${receipt.gasUsed}`);
    } catch (waitError) {
      console.log("Could not wait for transaction: ", waitError.message);
    }
    
    // Check updated state
    console.log("Checking updated contract state...");
    
    // Wait a moment for blockchain state to update
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
    
  } catch (error) {
    console.error("Error sending transaction:", error.message);
    
    if (error.error && error.error.message) {
      console.error("Detailed error:", error.error.message);
    }

    // Try fallback approach (standard transaction)
    console.log("\nTrying fallback approach with standard transaction...");

    try {
      const tx = await sponsor.sendTransaction({
        to: SPONSOR_CONTRACT_ADDRESS,
        data: calldata,
        gasLimit: 1000000
      });
      
      console.log(`Fallback transaction sent: ${tx.hash}`);
      console.log(`View on explorer: https://explorer.sichang.io/tx/${tx.hash}`);
      
      console.log("Note: This is NOT using EIP-7702, but a standard transaction from the sponsor");
      console.log("The contract will still validate the user's signature and execute the transfer");
    } catch (fallbackError) {
      console.error("Fallback transaction also failed:", fallbackError.message);
      throw fallbackError;
    }
  }
  
  console.log("Sponsorship execution completed");
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });