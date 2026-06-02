# syntax=docker/dockerfile:1
FROM golang:1.25-alpine AS builder

ARG TARGETOS
ARG TARGETARCH

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build \
    -ldflags="-s -w" \
    -o /out/mailhooks ./cmd/mailhooks/

FROM alpine:3.21

RUN apk add --no-cache ca-certificates tzdata

RUN adduser -D -s /bin/sh app

WORKDIR /app
COPY --from=builder /out/mailhooks /app/mailhooks

USER app

ENTRYPOINT ["/app/mailhooks"]
CMD ["-config", "config.yaml"]
