package syncer

import "github.com/emersion/go-imap/v2/imapclient"

type Connect struct {
	imapClient *imapclient.Client
}
