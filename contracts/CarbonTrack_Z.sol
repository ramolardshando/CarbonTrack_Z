pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CarbonTrack_Z is ZamaEthereumConfig {
    
    struct CarbonData {
        string userId;                    
        euint32 encryptedFootprint;        
        uint256 publicCategory;          
        uint256 publicMultiplier;          
        string description;            
        address creator;               
        uint256 timestamp;             
        uint32 decryptedFootprint; 
        bool isVerified; 
    }
    
    mapping(string => CarbonData) public carbonData;
    
    string[] public userRecords;
    
    event CarbonDataCreated(string indexed userId, address indexed creator);
    event DecryptionVerified(string indexed userId, uint32 decryptedFootprint);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createCarbonData(
        string calldata userId,
        string calldata name,
        externalEuint32 encryptedFootprint,
        bytes calldata inputProof,
        uint256 publicCategory,
        uint256 publicMultiplier,
        string calldata description
    ) external {
        require(bytes(carbonData[userId].userId).length == 0, "Carbon data already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedFootprint, inputProof)), "Invalid encrypted input");
        
        carbonData[userId] = CarbonData({
            userId: userId,
            encryptedFootprint: FHE.fromExternal(encryptedFootprint, inputProof),
            publicCategory: publicCategory,
            publicMultiplier: publicMultiplier,
            description: description,
            creator: msg.sender,
            timestamp: block.timestamp,
            decryptedFootprint: 0,
            isVerified: false
        });
        
        FHE.allowThis(carbonData[userId].encryptedFootprint);
        
        FHE.makePubliclyDecryptable(carbonData[userId].encryptedFootprint);
        
        userRecords.push(userId);
        
        emit CarbonDataCreated(userId, msg.sender);
    }
    
    function verifyDecryption(
        string calldata userId, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(carbonData[userId].userId).length > 0, "Carbon data does not exist");
        require(!carbonData[userId].isVerified, "Data already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(carbonData[userId].encryptedFootprint);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        
        carbonData[userId].decryptedFootprint = decodedValue;
        carbonData[userId].isVerified = true;
        
        emit DecryptionVerified(userId, decodedValue);
    }
    
    function getEncryptedFootprint(string calldata userId) external view returns (euint32) {
        require(bytes(carbonData[userId].userId).length > 0, "Carbon data does not exist");
        return carbonData[userId].encryptedFootprint;
    }
    
    function getCarbonData(string calldata userId) external view returns (
        string memory name,
        uint256 publicCategory,
        uint256 publicMultiplier,
        string memory description,
        address creator,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedFootprint
    ) {
        require(bytes(carbonData[userId].userId).length > 0, "Carbon data does not exist");
        CarbonData storage data = carbonData[userId];
        
        return (
            data.userId,
            data.publicCategory,
            data.publicMultiplier,
            data.description,
            data.creator,
            data.timestamp,
            data.isVerified,
            data.decryptedFootprint
        );
    }
    
    function getAllUserRecords() external view returns (string[] memory) {
        return userRecords;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}

