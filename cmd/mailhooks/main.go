package main

import (
	"context"
	"flag"
	"os"
	"os/signal"
	"syscall"

	"github.com/lipaysamart/mailhooks/internal/config"
	"github.com/lipaysamart/mailhooks/internal/logger"
	"github.com/lipaysamart/mailhooks/internal/queue"
	"github.com/lipaysamart/mailhooks/internal/state"
	"github.com/lipaysamart/mailhooks/internal/syncer"
	"go.uber.org/zap"
)

func main() {
	cfgPath := flag.String("config", "mailhooks.yaml", "config file path")
	flag.Parse()

	cfg, err := config.LoadConfig(*cfgPath)
	if err != nil {
		panic(err)
	}

	log, err := logger.New(cfg.Log.Level, cfg.Log.Format)
	if err != nil {
		panic(err)
	}

	queueCfg, err := cfg.Queue.Resolve()
	if err != nil {
		log.Fatal("invalid queue config", zap.Error(err))
	}

	q := queue.New(queueCfg, log)
	stateStore := state.NewStore("data")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	for _, acct := range cfg.Accounts {
		acct := acct
		acctResolved, err := acct.Resolve()
		if err != nil {
			log.Fatal("invalid account config",
				zap.String("account", acct.Name),
				zap.Error(err),
			)
		}

		s := syncer.New(acctResolved, q, stateStore, log)
		go s.Run(ctx)
	}

	go q.Consume(ctx)
	go q.CleanupLoop(ctx)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	log.Info("shutting down", zap.String("signal", sig.String()))
	cancel()
	q.Shutdown()
	log.Info("shutdown complete")
}
