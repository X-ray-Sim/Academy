# Academy Hetzner Deployment

This deployment uses a custom LearnHouse image built from this repository and hosted on GitHub Container Registry:

```text
ghcr.io/x-ray-sim/academy:latest
```

## 1. Publish the image

Push this repository to GitHub on the `main` branch:

```bash
git remote add academy https://github.com/X-ray-Sim/Academy.git
git push academy HEAD:main
```

The `Build Academy Image` GitHub Action builds the root `Dockerfile` and pushes these tags:

```text
ghcr.io/x-ray-sim/academy:latest
ghcr.io/x-ray-sim/academy:main
ghcr.io/x-ray-sim/academy:main-<short-sha>
```

In GitHub, open the package settings and make the package public. If you keep it private, create a GitHub personal access token with `read:packages` and use it on the server or in the deploy workflow as `GHCR_TOKEN`.

## 2. Point DNS at Hetzner

Create an `A` record:

```text
academy.vitasim.dk -> <hetzner-server-ipv4>
```

Also create an `AAAA` record if you enabled IPv6 on the server.

## 3. Prepare the server

SSH into the Hetzner server and install Docker, Node.js, and the firewall:

```bash
apt update
apt upgrade -y
apt install -y ca-certificates curl git ufw
curl -fsSL https://get.docker.com | sh
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

## 4. Generate the LearnHouse production stack

Run the LearnHouse setup wizard:

```bash
npx learnhouse@latest setup
```

Use these choices:

```text
Install name: academy
Domain: academy.vitasim.dk
HTTPS: Automatic SSL / Caddy
Database: local Docker PostgreSQL
Redis: local Docker Redis
Organization: VitaSim Academy
Storage: S3-compatible storage for production uploads, or local filesystem for the cheapest start
```

After setup, go to the generated install directory:

```bash
cd ~/.learnhouse/academy
```

## 5. Switch the stack to the custom image

Replace only the `learnhouse-app` image in `docker-compose.yml`:

```bash
python3 - "ghcr.io/x-ray-sim/academy:latest" <<'PY'
import sys
from pathlib import Path

image = sys.argv[1]
compose_path = Path("docker-compose.yml")
lines = compose_path.read_text().splitlines()
output = []
in_app = False
replaced = False

for line in lines:
    if line == "  learnhouse-app:":
        in_app = True
    elif in_app and line.startswith("  ") and not line.startswith("    "):
        in_app = False

    if in_app and line.strip().startswith("image:"):
        output.append(f"    image: {image}")
        replaced = True
    else:
        output.append(line)

if not replaced:
    raise SystemExit("Could not find learnhouse-app image line in docker-compose.yml")

compose_path.write_text("\n".join(output) + "\n")
PY
```

If the GHCR package is private, log in first:

```bash
echo "<github-token-with-read-packages>" | docker login ghcr.io -u "<github-username>" --password-stdin
```

Pull and restart:

```bash
docker compose pull learnhouse-app
docker compose up -d
docker compose ps
```

Check the site:

```bash
curl -I https://academy.vitasim.dk/api/v1/health
```

## 6. Optional GitHub Actions deploy

Add these repository secrets in GitHub:

```text
HETZNER_HOST=<server-ip>
HETZNER_USER=root
HETZNER_SSH_KEY=<private ssh key allowed to access the server>
HETZNER_DEPLOY_PATH=/root/.learnhouse/academy
GHCR_USERNAME=<github-username>
GHCR_TOKEN=<personal access token with read:packages, only needed for private package>
```

Then run the `Deploy Hetzner` workflow manually. It updates `docker-compose.yml` to the selected image tag, pulls the new image, and restarts the stack.
