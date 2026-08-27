FROM debian:10

ARG GLIB_VERSION=2.70.5
ARG MESON_VERSION=0.61.5
ARG DEBIAN_ARCHIVE_HOST=archive.debian.org

ENV DEBIAN_FRONTEND=noninteractive \
    GLIB_PREFIX=/opt/glib-2.70 \
    PKG_CONFIG_PATH=/opt/glib-2.70/lib/pkgconfig \
    LD_LIBRARY_PATH=/opt/glib-2.70/lib

# Debian 10 supplies glibc 2.28. Its packaged GLib is 2.58, so build the
# newer GLib required by the Rust GTK bindings into an isolated prefix.
RUN sed -i \
      -e "s|deb.debian.org/debian|${DEBIAN_ARCHIVE_HOST}/debian|g" \
      -e "s|security.debian.org/debian-security|${DEBIAN_ARCHIVE_HOST}/debian-security|g" \
      /etc/apt/sources.list \
    && apt-get -o Acquire::Check-Valid-Until=false update \
    && apt-get install -y --no-install-recommends \
      build-essential ca-certificates curl git pkg-config python3 python3-dev \
      gettext libffi-dev libmount-dev libpcre2-dev libselinux1-dev ninja-build \
      xz-utils zlib1g-dev libssl-dev \
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
