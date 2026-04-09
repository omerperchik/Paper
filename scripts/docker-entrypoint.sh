#!/bin/sh
set -e

# Capture runtime UID/GID from environment variables, defaulting to 1000
PUID=${USER_UID:-1000}
PGID=${USER_GID:-1000}

# Adjust the node user's UID/GID if they differ from the runtime request
# and fix volume ownership only when a remap is needed
changed=0

if [ "$(id -u node)" -ne "$PUID" ]; then
    echo "Updating node UID to $PUID"
    usermod -o -u "$PUID" node
    changed=1
fi

if [ "$(id -g node)" -ne "$PGID" ]; then
    echo "Updating node GID to $PGID"
    groupmod -o -g "$PGID" node
    usermod -g "$PGID" node
    changed=1
fi

if [ "$changed" = "1" ]; then
    chown -R node:node /paperclip
fi

# Ensure in-tree plugins are linked into the runtime plugin lookup path.
# The plugin-loader looks up workers under
# /paperclip/.paperclip/plugins/node_modules/@paperclipai/<plugin-name>.
# Plugins are built into /app/packages/plugins/<name>/dist at image build time
# (see Dockerfile). We create symlinks here so the resolution survives
# container recreate without losing the /paperclip volume state.
ensure_plugin_link() {
    plugin_src="$1"
    plugin_name="$2"
    link_dir="/paperclip/.paperclip/plugins/node_modules/@paperclipai"
    link_path="$link_dir/$plugin_name"
    if [ -d "$plugin_src" ]; then
        mkdir -p "$link_dir"
        # Recreate the symlink every start so it always points at the freshly
        # built source in the current image (important after image rebuilds).
        ln -sfn "$plugin_src" "$link_path"
        chown -h node:node "$link_path" 2>/dev/null || true
    fi
}

ensure_plugin_link /app/packages/plugins/whatsapp-gateway plugin-whatsapp-gateway

exec gosu node "$@"
