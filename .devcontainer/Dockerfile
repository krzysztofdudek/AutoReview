FROM mcr.microsoft.com/devcontainers/typescript-node:22

RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    ca-certificates \
    wget \
    apt-transport-https \
    && mkdir -p /etc/apt/keyrings \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

ENV PATH="/usr/local/bin:/usr/bin:${PATH}"
ENV SHELL=/bin/bash
