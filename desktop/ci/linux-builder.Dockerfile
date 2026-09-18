FROM debian:10

ARG GLIB_VERSION=2.70.5
ARG GLIB_NETWORKING_VERSION=2.66.0
ARG LIBSOUP_VERSION=3.2.3
ARG MESON_VERSION=0.61.5
ARG WEBKITGTK_VERSION=2.38.6
ARG DEBIAN_ARCHIVE_HOST=archive.debian.org

ENV DEBIAN_FRONTEND=noninteractive \
    GLIB_PREFIX=/opt/glib-2.70 \
    PKG_CONFIG_PATH=/opt/libsoup-3/lib/pkgconfig:/opt/glib-2.70/lib/pkgconfig \
    LD_LIBRARY_PATH=/opt/libsoup-3/lib:/opt/glib-2.70/lib

# Debian 10 supplies glibc 2.28. Its packaged GLib is 2.58, so build the
# newer GLib required by the Rust GTK bindings into an isolated prefix.
RUN sed -i \
      -e "s|deb.debian.org/debian|${DEBIAN_ARCHIVE_HOST}/debian|g" \
      -e "s|security.debian.org/debian-security|${DEBIAN_ARCHIVE_HOST}/debian-security|g" \
      /etc/apt/sources.list \
    && apt-get -o Acquire::Check-Valid-Until=false \
      -o Acquire::http::Timeout=30 -o Acquire::Retries=3 update \
    && apt-get -o Acquire::http::Timeout=30 -o Acquire::Retries=3 \
      install -y --no-install-recommends \
      bison build-essential ca-certificates cmake curl flex git gperf pkg-config \
      python3 python3-dev ruby \
      gettext libffi-dev libmount-dev libpcre2-dev libselinux1-dev ninja-build \
      xz-utils zlib1g-dev libssl-dev libbrotli-dev libgcrypt20-dev \
      libgnutls28-dev libnghttp2-dev libpsl-dev libsqlite3-dev libunistring-dev \
      libwebkit2gtk-4.0-dev libgtk-3-dev libayatana-appindicator3-dev \
      librsvg2-dev patchelf xdg-utils rpm \
      gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
      gstreamer1.0-libav gstreamer1.0-alsa

RUN curl --fail --location --silent --show-error \
      "https://github.com/mesonbuild/meson/archive/refs/tags/${MESON_VERSION}.tar.gz" \
      --output /tmp/meson.tar.gz \
    && tar -xzf /tmp/meson.tar.gz -C /opt \
    && ln -s "/opt/meson-${MESON_VERSION}/meson.py" /usr/local/bin/meson \
    && curl --fail --location --silent --show-error \
      "https://download.gnome.org/sources/glib/2.70/glib-${GLIB_VERSION}.tar.xz" \
      --output "/tmp/glib-${GLIB_VERSION}.tar.xz" \
    && tar -xJf "/tmp/glib-${GLIB_VERSION}.tar.xz" -C /tmp \
    && meson setup "/tmp/glib-${GLIB_VERSION}-build" "/tmp/glib-${GLIB_VERSION}" \
      --prefix="$GLIB_PREFIX" --libdir=lib --buildtype=release \
      -Dtests=false -Dinstalled_tests=false -Dman=false \
    && ninja -C "/tmp/glib-${GLIB_VERSION}-build" install

# Debian 10 has Soup 2 only. Build its Soup 3 dependency chain against the
# isolated GLib so WebKitGTK exposes the 4.1 API required by Tauri v2.
RUN curl --fail --location --silent --show-error \
      "https://download.gnome.org/sources/glib-networking/2.66/glib-networking-${GLIB_NETWORKING_VERSION}.tar.xz" \
      --output "/tmp/glib-networking-${GLIB_NETWORKING_VERSION}.tar.xz" \
    && tar -xJf "/tmp/glib-networking-${GLIB_NETWORKING_VERSION}.tar.xz" -C /tmp \
    && meson setup "/tmp/glib-networking-${GLIB_NETWORKING_VERSION}-build" \
      "/tmp/glib-networking-${GLIB_NETWORKING_VERSION}" \
      --prefix="$GLIB_PREFIX" --libdir=lib --buildtype=release \
    && ninja -C "/tmp/glib-networking-${GLIB_NETWORKING_VERSION}-build" install \
    && "$GLIB_PREFIX/bin/gio-querymodules" "$GLIB_PREFIX/lib/gio/modules" \
    && curl --fail --location --silent --show-error \
      "https://download.gnome.org/sources/libsoup/3.2/libsoup-${LIBSOUP_VERSION}.tar.xz" \
      --output "/tmp/libsoup-${LIBSOUP_VERSION}.tar.xz" \
    && tar -xJf "/tmp/libsoup-${LIBSOUP_VERSION}.tar.xz" -C /tmp \
    && meson setup "/tmp/libsoup-${LIBSOUP_VERSION}-build" \
      "/tmp/libsoup-${LIBSOUP_VERSION}" \
      --prefix=/opt/libsoup-3 --libdir=lib --buildtype=release \
      -Dtests=false -Dvapi=disabled -Dintrospection=disabled \
      -Dc_args=-Wno-error=nonnull \
    && ninja -C "/tmp/libsoup-${LIBSOUP_VERSION}-build" install \
    && curl --fail --location --silent --show-error \
      "https://webkitgtk.org/releases/webkitgtk-${WEBKITGTK_VERSION}.tar.xz" \
      --output "/tmp/webkitgtk-${WEBKITGTK_VERSION}.tar.xz" \
    && tar -xJf "/tmp/webkitgtk-${WEBKITGTK_VERSION}.tar.xz" -C /tmp \
    && cmake -S "/tmp/webkitgtk-${WEBKITGTK_VERSION}" \
      -B "/tmp/webkitgtk-${WEBKITGTK_VERSION}-build" -G Ninja \
      -DPORT=GTK -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/webkitgtk-4.1 \
      -DCMAKE_PREFIX_PATH="${GLIB_PREFIX};/opt/libsoup-3" \
      -DENABLE_DOCUMENTATION=OFF -DENABLE_GAMEPAD=OFF \
      -DENABLE_INTROSPECTION=OFF -DENABLE_JOURNALD_LOG=OFF \
      -DENABLE_MINIBROWSER=OFF -DENABLE_SPELLCHECK=OFF \
      -DENABLE_VIDEO=OFF -DENABLE_WEBDRIVER=OFF -DENABLE_WEB_CRYPTO=OFF \
      -DENABLE_WAYLAND_TARGET=OFF -DUSE_LIBSECRET=OFF \
      -DUSE_OPENGL_OR_ES=OFF -DUSE_SOUP2=OFF -DUSE_WPE_RENDERER=OFF \
    && ninja -C "/tmp/webkitgtk-${WEBKITGTK_VERSION}-build" install

# Keep the Rust compiler in the Debian 10 image so linked binaries retain its
# glibc 2.28 baseline and release jobs avoid reinstalling the toolchain.
ENV CARGO_HOME=/opt/cargo \
    RUSTUP_HOME=/opt/rustup \
    RUSTUP_DIST_SERVER=https://mirrors.ustc.edu.cn/rust-static \
    RUSTUP_UPDATE_ROOT=https://mirrors.ustc.edu.cn/rust-static/rustup \
    PATH=/opt/cargo/bin:$PATH

RUN mkdir -p "$CARGO_HOME" \
    && printf '%s\n' \
      '[source.crates-io]' \
      "replace-with = 'ustc'" \
      '' \
      '[source.ustc]' \
      'registry = "sparse+https://mirrors.ustc.edu.cn/crates.io-index/"' \
      '' \
      '[registries.ustc]' \
      'index = "sparse+https://mirrors.ustc.edu.cn/crates.io-index/"' \
      > "$CARGO_HOME/config.toml" \
    && curl --fail --location --retry 3 --connect-timeout 30 --max-time 300 \
      --silent --show-error \
      https://mirrors.ustc.edu.cn/misc/rustup-install.sh \
      --output /tmp/rustup-install.sh \
    && sh /tmp/rustup-install.sh -y --profile minimal \
      --default-toolchain stable --no-modify-path \
    && rustup --version \
    && rustc --version \
    && cargo --version
