# Setup Docker Hub Publishing

To publish Docker images to Docker Hub, you need to configure GitHub secrets.

## Steps

### 1. Create Docker Hub Access Token

1. Go to https://hub.docker.com/settings/security
2. Click **"New Access Token"**
3. Name: `github-actions-rita-room`
4. Access permissions: **Read, Write, Delete**
5. Click **Generate** and copy the token

### 2. Add GitHub Secrets

1. Go to your GitHub repository: https://github.com/farapholch/rita-room
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **"New repository secret"**
4. Add two secrets:

   **Secret 1:**
   - Name: `DOCKERHUB_USERNAME`
   - Value: Your Docker Hub username (e.g., `farapholch`)

   **Secret 2:**
   - Name: `DOCKERHUB_TOKEN`
   - Value: The access token you copied in step 1

### 3. Test Publishing

After adding the secrets, you can test by:

**Option A - Automatic (next release):**
- Make a commit with `feat:` or `fix:` prefix
- Auto-release will publish to both registries

**Option B - Manual:**
- Go to **Actions** → **"Publish Docker Image"**
- Click **"Run workflow"**
- Enter version (e.g., `1.0.1`)
- Click **"Run workflow"**

## Published Images

After setup, images will be available at:

- **Docker Hub**: `docker pull farapholch/rita-room:latest`
- **GitHub**: `docker pull ghcr.io/farapholch/rita-room:latest`

Both registries will have the same tags:
- `latest`
- `1` (major)
- `1.0` (minor)
- `1.0.1` (exact version)
