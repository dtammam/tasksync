FROM rustlang/rust:nightly-bookworm AS build
WORKDIR /app

COPY server/Cargo.toml Cargo.toml
COPY server/src src
COPY server/migrations migrations

RUN cargo build --release --bin tasksync-server --bin seed

FROM debian:bookworm-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/target/release/tasksync-server /usr/local/bin/tasksync-server
COPY --from=build /app/target/release/seed /usr/local/bin/seed

ENV DATABASE_URL=sqlite:///data/tasksync.db
ENV RUST_LOG=info
ENV PORT=3000

VOLUME ["/data"]
EXPOSE 3000

CMD ["tasksync-server"]