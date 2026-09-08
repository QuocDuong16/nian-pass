FROM rust:1.98.0-bookworm@sha256:82150a52ec202c1b14d7817e14516c392bb7f5cfebd88f1ed531cb37ebd39922 AS builder

WORKDIR /source
COPY . .
RUN cargo build --locked --release -p nian-pass-sync-gateway

FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

ARG NIAN_PASS_VERSION=0.1.0-rc.2
ARG NIAN_PASS_COMMIT=unknown
LABEL org.opencontainers.image.title="Nian Pass Sync Gateway" \
      org.opencontainers.image.version="${NIAN_PASS_VERSION}" \
      org.opencontainers.image.revision="${NIAN_PASS_COMMIT}" \
      org.opencontainers.image.source="https://git.niand.io.vn/coyote/nian-pass" \
      org.opencontainers.image.licenses="NOASSERTION"

RUN groupadd --gid 10001 nian-pass \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin nian-pass \
    && mkdir /data \
    && chown 10001:10001 /data \
    && chmod 0700 /data

COPY --from=builder /source/target/release/nian-pass-sync-gateway /usr/local/bin/nian-pass-sync-gateway

USER 10001:10001
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/nian-pass-sync-gateway"]
CMD ["--listen", "0.0.0.0:8080", "--storage-dir", "/data"]
