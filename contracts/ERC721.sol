// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

contract MemoriesToken is ERC721URIStorage, Ownable {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 1000;
    uint256 public totalMinted;

    // Image data URI (base64-encoded PNG provided at deployment)
    string private imageDataUri;

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _imageDataUri
    ) ERC721(_name, _symbol) Ownable(msg.sender) {
        require(bytes(_imageDataUri).length > 0, "image required");
        imageDataUri = _imageDataUri;
    }

    function mint(address to) external onlyOwner returns (uint256 tokenId) {
        require(totalMinted < MAX_SUPPLY, "max supply reached");
        tokenId = totalMinted + 1;
        totalMinted = tokenId;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, _buildTokenURI(tokenId));
    }

    function setImage(string calldata _imageDataUri) external onlyOwner {
        require(bytes(_imageDataUri).length > 0, "image required");
        imageDataUri = _imageDataUri;
    }

    function tokenURI(
        uint256 tokenId
    ) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "nonexistent token");
        return super.tokenURI(tokenId);
    }

    function _buildTokenURI(
        uint256 tokenId
    ) internal view returns (string memory) {
        bytes memory data = abi.encodePacked(
            "{",
            '"name":"Memories #',
            tokenId.toString(),
            '",',
            '"description":"Non-transfer-restricted memories token. Supply capped at 1000.",',
            '"image":"',
            imageDataUri,
            '"',
            "}"
        );

        return
            string(
                abi.encodePacked(
                    "data:application/json;base64,",
                    Base64.encode(data)
                )
            );
    }
}
