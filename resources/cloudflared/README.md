Place the official Cloudflare cloudflared release binaries in this directory before packaging:

- Windows x64: cloudflared.exe
- macOS Intel: cloudflared (or platform-specific packaging as needed)
- Linux x64: cloudflared

The application starts `cloudflared tunnel --url http://127.0.0.1:<port> --no-autoupdate` and parses the generated `trycloudflare.com` URL. Download binaries only from https://github.com/cloudflare/cloudflared/releases and verify their checksums.
