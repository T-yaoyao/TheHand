FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends git procps python3 python3-pip make g++ && \
    rm -rf /var/lib/apt/lists/*

# Install Playwright for screenshots
RUN pip install --break-system-packages playwright && playwright install chromium

WORKDIR /sandbox

CMD ["sleep", "infinity"]
