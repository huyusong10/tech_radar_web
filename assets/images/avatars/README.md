# Avatar Images

This directory stores avatar images for authors.

## File Naming Convention

- Use author ID as filename: `{author_id}.jpg` or `{author_id}.png`
- Example: `zhang_wei.jpg`, `li_ming.jpg`

## Image Requirements

- Recommended size: 150x150px or larger (square)
- Format: JPG or PNG
- File size: < 100KB (recommended)

## Adding a New Avatar

1. Add the image file to this directory with the author's ID as the filename
2. Reference it in the author's profile: `/assets/images/avatars/{author_id}.jpg`

## Temporary Setup

Until actual avatar images are added, you can:
1. Download images from https://i.pravatar.cc/150?img=XX (where XX is a number)
2. Or use placeholder images from https://via.placeholder.com/150
3. Save them with the author ID as filename

Example commands to download placeholder images:
```bash
curl -o zhang_wei.jpg "https://i.pravatar.cc/150?img=33"
curl -o li_ming.jpg "https://i.pravatar.cc/150?img=12"
curl -o wang_fang.jpg "https://i.pravatar.cc/150?img=45"
curl -o chen_hao.jpg "https://i.pravatar.cc/150?img=68"
```
