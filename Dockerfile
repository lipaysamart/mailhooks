# syntax=docker/dockerfile:1
FROM golang:1.25-alpine AS builder

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/mailhooks ./cmd/mailhooks/

FROM alpine:3.21

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app
COPY --from=builder /out/mailhooks /app/mailhooks

EXPOSE 8080

ENTRYPOINT ["/app/mailhooks"]
CMD ["-config", "config.yaml"]
