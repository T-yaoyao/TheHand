FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends git procps python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /sandbox

CMD ["sleep", "infinity"]
