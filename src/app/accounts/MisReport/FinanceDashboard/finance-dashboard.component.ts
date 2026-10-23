import { Component, HostListener, OnInit, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { IMyDpOptions } from 'mydatepicker';
import { DataService } from '../../../shared/service/dataService';
import { LoginService } from '../../../shared/service/loginService';
import { ToastCommonService } from '../../../shared/service/toastService';
import { LoaderService } from '../../../shared/service/loader.service';
import { ExportexcelService } from 'src/app/shared/service/exportexcel.service';

import { FinPager, finFigure } from '../../Accreport/fin-kit';
/*  Links port of the MPERPNG-20 Finance dashboard (MP commits 2c9513f / 297bee6 / cddd6de).
    import-page.css and accreport-page.css are GLOBAL in Links (src/styles/kit/*); the host
    class "kit-accreport" opts this page into the accreport add-on. Only the page's own
    stylesheet stays component-scoped.                                                      */
@Component({
    selector: 'app-FinanceDashboard',
    templateUrl: './finance-dashboard.component.html',
    styleUrls: ['./finance-dashboard-page.css'],
    host: { class: 'kit-accreport' },
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class FinanceDashboardComponent implements OnInit {

    /* dates are sent to the proc as dd/MM/yyyy, so the picker uses the same format */
    public myDatePickerOptions: IMyDpOptions = {
        dateFormat: 'dd/mm/yyyy',
        inline: false,
        height: '20px',
        width: '130px',
        componentDisabled: false,
        selectionTxtFontSize: '12px',
        editableDateField: false,
        sunHighlight: true,
        satHighlight: true,
        firstDayOfWeek: 'su',
        openSelectorTopOfInput: false,
        openSelectorOnInputClick: true,
        selectorHeight: '180px',
        selectorWidth: '200px'
    };

    Header = 'Finance Dashboard';
    cmpnyname: string;

    /* ---- filters ---- */
    FromDate: any;
    ToDate: any;
    BranchList: any[] = [];
    Branch: any;
    BranchLabel = '';
    ClientCode: any = null;
    ClientList: any[] = [];
    ClientMaster: any[] = [];      // full client master (~13k rows), loaded on first use of the type-ahead
    ClientMasterState = 'IDLE';    // IDLE | LOADING | READY | FAILED
    ClientQuery = '';              // what is typed in the client type-ahead
    ClientPickOpen = false;
    CurrencyMode = 'INR';          // 'INR' | 'TXN'
    TopN = 10;

    Searched = false;
    Tab = 'RECEIVABLES';           // Detail section tabs: RECEIVABLES | MARGIN | UNBILLED | PAYABLES (audit lives in Reference)

    /* ---- result sets ---- */
    Kpi: any = null;
    Exposure: any[] = [];
    Recovery: any[] = [];
    Mix: any[] = [];
    UnbilledAge: any[] = [];
    UnbilledJobs: any[] = [];
    Ageing: any[] = [];
    Margin: any[] = [];            // Table7: grouped by the party that was BILLED
    MarginShipper: any[] = [];     // Table12: the same money grouped by the shipper

    /*  Export freight is very often billed to the overseas agent rather than to the
        shipper: on Links Mumbai FY2026-27 that is half the export revenue. The job
        file names the shipper, the invoice names the payer, so grouping margin by the
        job party left clients with real invoices showing an empty Margin tab. The
        screen now carries both groupings and defaults to the billed party, which is
        the one the ledger, Receivables and Outstanding all use.                      */
    MarginBy: string = 'BILLED';   // 'BILLED' | 'SHIPPER'
    SetMarginBy(mode: string) {
        if (this.MarginBy === mode) { return; }
        this.MarginBy = mode;
        this.MarginOpen = {};      // open drills belong to the other grouping
        this.marginPager.set(this.MarginSorted());
        this.BuildMarginBars();
    }
    MarginRows(): any[] { return (this.MarginBy === 'SHIPPER' ? this.MarginShipper : this.Margin) || []; }
    /* the column a margin row is keyed on, and the job field that matches it */
    MarginKey(): string { return this.MarginBy === 'SHIPPER' ? 'CLIENTCODE' : 'BILLCLIENT'; }
    OtherLabel(): string { return this.MarginBy === 'SHIPPER' ? 'Billed to' : 'Cargo of'; }
    JobPL: any[] = [];             // Table8: job-wise income/expense/P&L (Job Profit grain)
    JobSplit: any[] = [];          // Table13: each job's P&L split by the client billed (Billed-party view)
    UnbilledLines: any[] = [];     // Table9: voucher-level expense lines behind unbilled jobs
    Funnel: any[] = [];            // Table10: Jobs -> Invoiced -> Collected
    Coverage: any = null;          // Table11: billing coverage / invoicing lag
    FyYears: any[] = [];           // Table15: outstanding by the financial year of the bill
    /*  The client breakdown is deliberately NOT part of this page's load - it was 639
        rows on Links and 1,692 on Manilal fetched on every open, and it held the other
        menus up. It comes from the drill procedure, only when somebody asks for it.  */
    FyClients: any[] = [];
    FyDetail = false;
    FyBusy = false;
    FyError = '';
    FyOpen: number = null;         // the year whose modal is open
    FyLabel = '';
    FyRow: any = null;
    /*  Table16: the voucher lines behind the amber "unmatched" pill. The procedure only
        returns them when ONE client is selected - across all clients it was 2,898 rows
        on top of a payload that already carries 8,700, on a page that loads every time.
        So the pill re-runs the dashboard for that client first, then opens.  */
    UnmLinesAll: any[] = [];
    UnmJob: any = null;            // the job row whose lines are open
    UnmPending: string = null;     // job we should open once the client load finishes
    /*  Table17/Table18: every open bill and every credit behind ONE client's
        Outstanding. Only filled when a single client is selected - across all clients it
        would be tens of thousands of rows. They prove the card:
            sum(bill PENDING) - sum(credit AMOUNT) = that client's Outstanding  */
    OsBills: any[] = [];
    OsCredits: any[] = [];
    AllBillsBusy = false;          // the whole-book export is fetching
    CacheInfo: any = null;         // CACHEINFO appended by the API cache

    /* expanded-row state for the Margin (per client) and Unbilled (per job) drills */
    MarginOpen: any = {};
    UnbilledOpen: any = {};

    /* ---- AUDIT tab (fetched on first activation, never with the dashboard) ---- */
    AuditSummary: any[] = [];
    AuditDetail: any[] = [];
    AuditLoaded = false;
    AuditLoading = false;
    AuditUnavailable = false;      // Links: USP_ACC_RPT_FINANCE_DASHBOARD_AUDIT not deployed yet -> empty state
    AuditOpen: any = {};
    ShowPassing = false;

    /* ---- payment reminder composer ---- */
    ReminderOpen = false;
    ReminderClient: any = null;
    ReminderText = '';
    ReminderSubject = '';

    /* ---- job profit drawer: a compact Job Profit statement inside the dashboard, from the
       same proc the popup page uses (ACC_RPT_JOBPROFITS_JOBWISE), so checking many jobs
       does not mean many windows. The Window button still opens the full popup page. ---- */
    JobDrawerNo: string = null;
    JobLoading = false;
    JobFailed = false;
    JobInfo: any = {};             // Table1: invoice / party block
    JobHeads: any[] = [];          // Table2: one row per account head
    JobIncome = 0;
    JobExpense = 0;

    /* ---- legend / help: what every badge, colour and abbreviation means ---- */
    LegendOpen = false;

    /* ---- PAYABLES tab (whom do we owe) --------------------------------------
       Fetched on first activation only, never with the dashboard: it is a
       separate proc and a payables user does not open it every time.
       UNDER TEST - the figures have not yet been reconciled with Accounts, so the
       tab carries a banner saying so. Remove the banner, not the caveat, once the
       three-supplier reconciliation passes.                                     */
    PayLoaded = false;
    PayLoading = false;
    PayKpi: any = null;
    PaySupp: any[] = [];          // Table1 supplier exposure
    PayAge: any[] = [];           // Table3 portfolio ageing buckets
    PayFlow: any[] = [];          // Table4 cash forecast
    PayBills: any[] = [];         // Table5 open bill worklist
    PaySpeed: any[] = [];         // Table6 how fast we pay
    PayUnlinked: any = null;      // Table7 cost with no job number
    PayDqSum: any[] = [];         // Table8 discrepancy summary
    PayDqRows: any[] = [];        // Table9 discrepancy rows
    PayCacheInfo: any = null;
    PayLookback = '12';           // months of purchase history
    PayInflow = false;            // include the receivable leg of the forecast
    PayView = 'SUPPLIER';         // SUPPLIER | BILLS | DQ
    PayDqOpen: any = {};
    PayOverdueOnly = false;

    /* ---- client drill-down ---- */
    DrillClient: any = null;
    DrillAgeing: any = null;
    DrillMargin: any[] = [];
    DrillJobs: any[] = [];

    /* ---- chart source data (drawn as inline SVG / CSS bars by BuildView, greyscale) ---- */
    recoveryLabels: string[] = [];
    recoveryData: any[] = [];
    mixLabels: string[] = [];
    mixData: any[] = [{ data: [] }];
    ageingLabels: string[] = ['0-30', '31-60', '61-90', '91-120', '121-180', '181-365', '366-730', '731-1095', '1095+'];
    ageingData: any[] = [];

    constructor(private _dataService: DataService,
        private _toasterService: ToastCommonService,
        private loaderService: LoaderService,
        private _loginService: LoginService,
        private exportser: ExportexcelService,
        private cdr: ChangeDetectorRef) { }

    /* async HTTP callbacks sometimes leave the view stale in this app; repaint explicitly */
    private repaint() {
        this.cdr.markForCheck();
        try { this.cdr.detectChanges(); } catch (e) { /* view already destroyed */ }
    }

    ngOnInit() {
        /* default period = current Indian financial year to date, built from the JS date
           rather than parsed from the login string, so no date-format guessing */
        const today = new Date();
        const fyStartYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
        const fyStart = new Date(fyStartYear, 3, 1);

        /* mydatepicker's [selDate] takes either a string in the configured dateFormat
           or an IMyDate {year, month, day}. It must NOT be the {date:{...}, formatted}
           wrapper that DataService.stringdttoArry returns - that has no year/month/day,
           so the input renders "undefined/undefined" and the calendar loses its month.
           Plain dd/mm/yyyy strings, same as the P&L page. */
        this.FromDate = this._dataService.datechnge(fyStart);
        this.ToDate = this._dataService.datechnge(today);

        this.Branch = this._loginService.getLogin()[0].CITYCODE1;
        this.FillBranches();

        const jsonmaster = {
            CmpCode: this._loginService.getLogin()[0].CMPCODE,
            CityCode: this._loginService.getLogin()[0].CITYCODE
        };
        this._dataService.getData('Accounts/fn_Acc_Rpt_Common_CompanyDetails', jsonmaster)
            .subscribe((data: any) => {
                if (data && data.Table && data.Table.length > 0) { this.cmpnyname = data.Table[0].cmp_name; }
                this.repaint();
            });

        this.VerifyPageRights();

        /* redesign: open on the default period instead of an empty page */
        this.Submit();
    }

    /*  Page gating - unchanged from the Links page before the redesign, kept in this one
        member: user form rights, form no 442 = Finance Dashboard, 'View' right.          */
    private VerifyPageRights() {
        this._loginService.verifyRights(442, '')
            .subscribe((data: any) => { this._loginService.checkVerify('View', data); });
    }

    FromDateChanged(ev) { this.FromDate = ev.formatted; }
    ToDateChanged(ev) { this.ToDate = ev.formatted; }

    FillBranches() {
        const json = { CMPCODE: this._loginService.getLogin()[0].CMPCODE };
        this._dataService.getData('Accounts/ACC_RPT_COMPANY_BRANCH_LIST', json)
            .subscribe((data: any) => {
                const list = (data && data.Table) ? data.Table : [];
                this.BranchList = [{ CITYCODE1: 'ALL', CITYNAME: 'ALL BRANCHES (CONSOLIDATED)' }].concat(list);
                /* the first load can finish before the branch list; fill the label in afterwards */
                const bsel = this.BranchList.find(b => b.CITYCODE1 === this.Branch);
                if (bsel && this.Searched) { this.BranchLabel = bsel.CITYNAME; }
                this.repaint();
            });
    }

    /* Client type-ahead. The master (ACC_CMP_FillClient, ~13,000 rows) is fetched once, on
       first focus, and never bound to a list: matches are filtered client-side only after
       2+ characters and capped at 20. Until it has loaded (or if it fails) matches come
       from the clients in the current result, as before the port.                        */
    FillClients() {
        if (this.ClientMasterState === 'LOADING' || this.ClientMasterState === 'READY') { return; }
        this.ClientMasterState = 'LOADING';
        const login = this._loginService.getLogin()[0];
        const json = { cmpcode: login.CMPCODE, citycode: login.CITYCODE, citycode1: login.CITYCODE1 };
        this._dataService.getData('Accounts/ACC_CMP_FillClient', json)
            .subscribe((data: any) => {
                const rows = (data && data.Table) ? data.Table : [];
                this.ClientMaster = rows
                    .map(r => ({ CODE: r.acctcodename || r.ACCTCODENAME || r.acctcode || r.ACCTCODE,
                                 NAME: r.acctname || r.ACCTNAME }))
                    .filter(r => r.CODE && r.NAME)
                    .map(r => Object.assign(r, { KEY: (r.NAME + ' ' + r.CODE).toUpperCase() }));
                this.ClientMasterState = 'READY';
                this.repaint();
            }, () => { this.ClientMasterState = 'FAILED'; this.repaint(); });
    }
    ClientFocus() { this.ClientPickOpen = true; this.FillClients(); }
    /* delay so a mousedown on a match lands before the list closes */
    ClientBlur() { setTimeout(() => { this.ClientPickOpen = false; this.repaint(); }, 150); }
    ClientTyped(q: string) {
        this.ClientQuery = q;
        this.ClientPickOpen = true;
        if (!q) { this.ClientCode = null; }
    }
    ClientMatches(): any[] {
        const q = (this.ClientQuery || '').trim().toUpperCase();
        if (q.length < 2) { return []; }
        const src = this.ClientMaster.length ? this.ClientMaster : this.ClientList;
        const out: any[] = [];
        for (const c of src) {
            const key = c.KEY || ((c.NAME || '') + ' ' + (c.CODE || '')).toUpperCase();
            if (key.indexOf(q) >= 0) { out.push(c); if (out.length >= 20) { break; } }
        }
        return out;
    }
    PickClient(c: any) {
        this.ClientCode = c.CODE;
        this.ClientQuery = c.NAME;
        this.ClientPickOpen = false;
        /* remember the name so the active-filter chip can show it */
        if (!this.ClientList.find(x => x.CODE === c.CODE)) {
            this.ClientList = this.ClientList.concat([{ CODE: c.CODE, NAME: c.NAME }]);
        }
    }

    /* the pickers hold plain dd/mm/yyyy strings; tolerate an event object too */
    private fmtDate(d): string {
        if (!d) { return ''; }
        return (typeof d === 'string') ? d : (d.formatted ? d.formatted : '');
    }

    Submit(syncNow: boolean = false) {
        const from = this.fmtDate(this.FromDate);
        const to = this.fmtDate(this.ToDate);

        if (!from || !to) {
            this._toasterService.toast('warning', 'warning', 'Please select both From and To dates !');
            return;
        }
        if (this._dataService.dateTWoComparison(from, to)) {
            this._toasterService.toast('warning', 'warning', 'To Date cannot be earlier than From Date !');
            return;
        }

        /* redesign: no global blocking loader - skeletons render while Loading is true,
           so the sidebar stays usable */
        this.Loading = true;
        this.LoadFailed = false;
        this.DrillClient = null;

        const bsel = this.BranchList.find(b => b.CITYCODE1 === this.Branch);
        this.BranchLabel = bsel ? bsel.CITYNAME : this.Branch;

        const jsonItem: any = {
            FROMDATE: from,
            TODATE: to,
            CMPCODE: this._loginService.getLogin()[0].CMPCODE,
            CITYCODE: this.Branch,
            CLIENTCODE: this.ClientCode ? this.ClientCode : '',
            TOPN: this.TopN
        };
        if (syncNow) { jsonItem.SYNCNOW = '1'; }

        this._dataService.getData('Accounts/ACC_RPT_FINANCE_DASHBOARD', jsonItem)
            .subscribe((data: any) => {
                this.Loading = false;

                if (!data || !data.Table || data.Table.length === 0) {
                    this.Searched = false;
                    this.NoData = true;
                    this._toasterService.toast('warning', 'warning', 'No Record Found !');
                    this.repaint();
                    return;
                }
                this.NoData = false;

                this.Kpi = data.Table[0];
                this.Exposure = data.Table1 ? data.Table1 : [];
                this.Recovery = data.Table2 ? data.Table2 : [];
                this.Mix = data.Table3 ? data.Table3 : [];
                this.UnbilledAge = data.Table4 ? data.Table4 : [];
                this.UnbilledJobs = data.Table5 ? data.Table5 : [];
                this.Ageing = data.Table6 ? data.Table6 : [];
                this.Margin = data.Table7 ? data.Table7 : [];
                this.MarginShipper = data.Table12 ? data.Table12 : [];
                this.JobSplit = data.Table13 ? data.Table13 : [];
                this.FyYears = data.Table15 ? data.Table15 : [];
                this.UnmLinesAll = data.Table16 ? data.Table16 : [];
                this.OsBills = data.Table17 ? data.Table17 : [];
                this.OsCredits = data.Table18 ? data.Table18 : [];
                if (this.UnmPending) {
                    const jb = this.UnmPending;
                    this.UnmPending = null;
                    const row = this.JobSplit.find(s => (s.JOBNO || '').toString().trim() === jb);
                    if (row && this.UnmLinesFor(row).length) { this.UnmJob = row; }
                }
                this.JobPL = data.Table8 ? data.Table8 : [];
                this.UnbilledLines = data.Table9 ? data.Table9 : [];
                this.Funnel = data.Table10 ? data.Table10 : [];
                this.Coverage = (data.Table11 && data.Table11.length > 0) ? data.Table11[0] : null;
                this.CacheInfo = (data.CACHEINFO && data.CACHEINFO.length > 0) ? data.CACHEINFO[0] : null;
                this.MarginOpen = {};
                this.UnbilledOpen = {};
                /* the audit belongs to a filter set; a new Submit invalidates it */
                this.AuditLoaded = false;
                this.AuditUnavailable = false;
                this.AuditSummary = [];
                this.AuditDetail = [];
                /* so do the payables (same period and branch): drop them, and re-fetch
                   straight away if that tab is the one on screen */
                this.PayLoaded = false;
                this.PayKpi = null;
                this.PayUnlinked = null;
                this.PayBills = [];
                this.SetPayDerived();
                /* payables feed the attention tiles, Act now and This week, so they load with
                   every Submit now (same call the Payables tab always made). Quiet: an empty
                   payable result is already said on the tiles, so no extra toast here. */
                this.LoadPayables(false, true);
                if (this.RefAuditOpen) { this.LoadAudit(); }

                /* clients in the result: the type-ahead's fallback source and the chip's names */
                if (!this.ClientCode) {
                    this.ClientList = this.Exposure.map(r => ({ CODE: r.CLIENTCODE, NAME: r.CLIENTNAME }));
                }

                this.BuildCharts();
                this.BuildView();
                this.Searched = true;
                this.repaint();
            }, () => {
                this.Loading = false;
                this.LoadFailed = true;
                this._toasterService.toast('error', 'error', 'Error while loading Finance Dashboard !');
                this.repaint();
            });
    }

    BuildCharts() {
        /* credit period vs actual recovery days, top N by billing */
        this.recoveryLabels = this.Recovery.map(r => this.shortName(r.CLIENTNAME));
        this.recoveryData = [
            { data: this.Recovery.map(r => this.num(r.CREDIT_PERIOD)), label: 'Credit period (days)' },
            { data: this.Recovery.map(r => this.num(r.ACTUAL_DAYS_WTD)), label: 'Actual recovery (days)' }
        ];

        /* taxable vs non-taxable, normalised to INR */
        const t = this.num(this.Kpi.TAXABLE_INR);
        const nt = this.num(this.Kpi.NONTAXABLE_INR);
        const tf = this.num(this.Kpi.TAXABLE_FX_INR);
        const ntf = this.num(this.Kpi.NONTAXABLE_FX_INR);
        this.mixLabels = ['Taxable (INR)', 'Non-taxable (INR)', 'Taxable (Foreign)', 'Non-taxable (Foreign)'];
        this.mixData = [{ data: [t, nt, tf, ntf] }];

        /* receivable ageing, summed across the returned clients */
        const cols = ['DAYS_000_030', 'DAYS_031_060', 'DAYS_061_090', 'DAYS_091_120', 'DAYS_121_180',
            'DAYS_181_365', 'DAYS_366_730', 'DAYS_731_1095', 'DAYS_1096_9999'];
        const totals = cols.map(c => this.Ageing.reduce((s, r) => s + this.num(r[c]), 0));
        this.ageingData = [{ data: totals, label: 'Receivable' }];
    }

    /* ---- client drill-down (requirement: total exposure for a particular client) ---- */
    OpenDrill(row: any) {
        this.DrillClient = row;
        this.DrillAgeing = this.Ageing.find(a => a.CLIENTCODE === row.CLIENTCODE) || null;
        this.DrillMargin = this.MarginRows().filter(m => m.CLIENTCODE === row.CLIENTCODE);
        this.DrillJobs = this.UnbilledJobs.filter(j => j.CLIENTCODE === row.CLIENTCODE);
    }
    CloseDrill() { this.DrillClient = null; }

    /* re-run the whole dashboard scoped to one client */
    LoadClient(code: string) {
        this.ClientCode = code;
        const c = this.ClientList.find(x => x.CODE === code);
        this.ClientQuery = c ? c.NAME : code;
        this.Submit();
    }
    /* name + code for the active-filter chip; falls back to the code alone */
    ClientLabel(): string {
        const c = this.ClientList.find(x => x.CODE === this.ClientCode)
               || this.ClientMaster.find(x => x.CODE === this.ClientCode);
        return c ? (c.NAME + ' (' + c.CODE + ')') : this.ClientCode;
    }

    ClearClient() {
        this.ClientCode = null;
        this.ClientQuery = '';
        this.Submit();
    }

    BackToSearch() { this.Searched = false; }

    SyncNow() { this.Submit(true); }

    /* ---- AUDIT / PAYABLES tabs: fetched live on first activation, never with the dashboard ---- */
    SetTab(tab: string) {
        this.Tab = tab;
        if (tab === 'AUDIT' && !this.AuditLoaded && !this.AuditLoading) { this.LoadAudit(); }
        if (tab === 'PAYABLES' && !this.PayLoaded && !this.PayLoading) { this.LoadPayables(); }
    }

    /* ---------------------------------------------------------------------------
       PAYABLES
       Same period and branch as the rest of the screen. SUPPLIERCODE is blank -
       the client filter above belongs to the receivable side and must not leak in.
       No global loader (redesign): PayLoading drives an inline skeleton.
    --------------------------------------------------------------------------- */
    LoadPayables(syncNow: boolean = false, quiet: boolean = false) {
        const from = this.fmtDate(this.FromDate), to = this.fmtDate(this.ToDate);
        if (!from || !to) {
            this._toasterService.toast('warning', 'warning', 'Please select both From and To dates !');
            return;
        }
        this.PayLoading = true;
        const jsonItem: any = {
            FROMDATE: from,
            TODATE: to,
            CMPCODE: this._loginService.getLogin()[0].CMPCODE,
            CITYCODE: this.Branch,
            SUPPLIERCODE: '',
            TOPN: this.TopN,
            LOOKBACK: this.PayLookback,
            INFLOW: this.PayInflow ? '1' : '0'
        };
        if (syncNow) { jsonItem.SYNCNOW = '1'; }

        this._dataService.getData('Accounts/ACC_RPT_PAYABLE_DASHBOARD', jsonItem)
            .subscribe((data: any) => {
                this.PayLoading = false;
                if (!data || !data.Table || data.Table.length === 0) {
                    if (!quiet) { this._toasterService.toast('warning', 'warning', 'No payable data found for this period !'); }
                    this.PayLoaded = true;
                    this.repaint();
                    return;
                }
                this.PayKpi       = data.Table[0];
                this.PaySupp      = data.Table1 ? data.Table1 : [];
                this.PayAge       = data.Table3 ? data.Table3 : [];
                this.PayFlow      = data.Table4 ? data.Table4 : [];
                this.PayBills     = data.Table5 ? data.Table5 : [];
                this.PaySpeed     = data.Table6 ? data.Table6 : [];
                this.PayUnlinked  = (data.Table7 && data.Table7.length) ? data.Table7[0] : null;
                this.PayDqSum     = data.Table8 ? data.Table8 : [];
                this.PayDqRows    = data.Table9 ? data.Table9 : [];
                this.PayCacheInfo = (data.CACHEINFO && data.CACHEINFO.length) ? data.CACHEINFO[0] : null;
                this.PayDqOpen    = {};
                this.PayLoaded    = true;
                this.paySuppPager.set(this.PaySupp);
                this.payBillPager.set(this.PayBillRows());
                this.SetPayDerived();
                this.repaint();
            }, () => {
                this.PayLoading = false;
                this._toasterService.toast('error', 'error', 'Error while loading Payables !');
                this.repaint();
            });
    }
    ReloadPayables() { this.PayLoaded = false; this.LoadPayables(); }
    SyncPayables()   { this.LoadPayables(true); }

    paySuppPager = new FinPager<any>(10);
    payBillPager = new FinPager<any>(10);
    SetPayOverdueOnly(v: boolean) { this.PayOverdueOnly = v; this.payBillPager.set(this.PayBillRows()); }

    /* rows of the bill worklist, honouring the "overdue only" switch */
    PayBillRows(): any[] {
        return this.PayOverdueOnly ? this.PayBills.filter(b => this.num(b.OVERDUE_DAYS) > 0) : this.PayBills;
    }
    /* discrepancy rows for one issue code */
    PayDqFor(code: string): any[] {
        return this.PayDqRows.filter(r => r.ISSUE_CODE === code);
    }
    TogglePayDq(code: string) { this.PayDqOpen[code] = !this.PayDqOpen[code]; }

    /* severity 1 = the figures on screen are affected */
    dqClass(sev: any): string {
        const n = this.num(sev);
        return n === 1 ? 'fd-pill--red' : (n === 2 ? 'fd-pill--amber' : 'fd-pill--muted');
    }
    dqLabel(sev: any): string {
        const n = this.num(sev);
        return n === 1 ? 'AFFECTS FIGURES' : (n === 2 ? 'ASSUMED VALUE' : 'FYI');
    }
    payStatusClass(st: string): string {
        switch ((st || '').toUpperCase()) {
            case 'OVERDUE-OLD': return 'fd-pill--red';
            case 'OVERDUE':     return 'fd-pill--amber';
            case 'SETTLED':     return 'fd-pill--muted';
            default:            return 'fd-pill--green';
        }
    }
    /* share of the payable that is overdue, for the meter */
    payOverduePct(): number {
        if (!this.PayKpi) { return 0; }
        return this.pctOf(this.PayKpi.OVERDUE_AMT, this.PayKpi.TOTAL_PAYABLE);
    }
    /* biggest bucket width, for the ageing bar */
    payAgeWidth(a: any): number {
        const max = Math.max.apply(null, this.PayAge.map(x => this.num(x.AMOUNT)).concat([1]));
        return max > 0 ? (this.num(a.AMOUNT) / max) * 100 : 0;
    }

    LoadAudit() {
        this.AuditLoading = true;
        const jsonItem = {
            FROMDATE: this.fmtDate(this.FromDate),
            TODATE: this.fmtDate(this.ToDate),
            CMPCODE: this._loginService.getLogin()[0].CMPCODE,
            CITYCODE: this.Branch,
            CLIENTCODE: '',
            TOPN: this.TopN
        };
        /* redesign: AuditLoading drives an inline skeleton; no global loader */
        this._dataService.getData('Accounts/ACC_RPT_FINANCE_DASHBOARD_AUDIT', jsonItem)
            .subscribe((data: any) => {
                this.AuditLoading = false;
                /* The Links API swallows a missing proc and answers 200 with an empty
                   DataSet. No Table at all = the audit proc is not deployed: say so instead
                   of "All checks passing" (fail soft, no toast). */
                this.AuditUnavailable = !(data && data.Table);
                this.AuditSummary = data && data.Table ? data.Table : [];
                this.AuditDetail = data && data.Table1 ? data.Table1 : [];
                this.AuditOpen = {};
                this.AuditLoaded = true;
                this.repaint();
            }, () => {
                /* fail soft: empty state in the Reference section, no error toast */
                this.AuditLoading = false;
                this.AuditUnavailable = true;
                this.AuditSummary = [];
                this.AuditDetail = [];
                this.AuditLoaded = true;
                this.repaint();
            });
    }

    ToggleAudit(code: string) { this.AuditOpen[code] = !this.AuditOpen[code]; }
    AuditRows(code: string): any[] { return this.AuditDetail.filter(d => d.CHECK_CODE === code); }
    VisibleChecks(): any[] {
        return this.ShowPassing ? this.AuditSummary : this.AuditSummary.filter(c => this.num(c.ITEMS) > 0);
    }
    sevClass(sev: string): string {
        switch (sev) {
            case 'HIGH': return 'fd-pill--red';
            case 'MEDIUM': return 'fd-pill--amber';
            default: return 'fd-pill--grey';
        }
    }

    ExportAudit() {
        if (!this.AuditDetail || this.AuditDetail.length === 0) {
            this._toasterService.toast('warning', 'warning', 'Nothing to export !');
            return;
        }
        const headers = Object.keys(this.AuditDetail[0]);
        const rows = this.AuditDetail.map(r => headers.map(h => r[h]));
        this.exportser.exportExceltry({
            data: rows,
            headers: headers,
            pagetype: 'FinanceDashboardAudit',
            title: this.cmpnyname,
            subtitle: 'Data Quality Audit - ' + this.BranchLabel + ' - '
                + this.fmtDate(this.FromDate) + ' to ' + this.fmtDate(this.ToDate)
        }, 'FinanceDashboard_Audit_');
    }

    /* ---- payment reminder: composed in the browser, sent from the USER'S mail client.
       No SMTP on the server, no password handling, and the sender reviews the body
       before anything leaves the building. ---- */
    OpenReminder(r: any, ev?: any) {
        if (ev) { ev.stopPropagation(); }
        this.ReminderClient = r;
        const age = this.Ageing.find(a => a.CLIENTCODE === r.CLIENTCODE);
        const nl = '\r\n';
        const lines: string[] = [];
        this.ReminderSubject = 'Payment reminder - outstanding balance '
            + this.fmtINR(r.OUTSTANDING) + ' as on ' + this.fmtDate(this.ToDate);
        lines.push('Dear Sir / Madam,');
        lines.push('');
        lines.push('Greetings from ' + (this.cmpnyname || 'Manilal Patel Group') + '.');
        lines.push('');
        lines.push('As per our records, the following balance is outstanding against '
            + r.CLIENTNAME + ' (' + r.CLIENTCODE + ') as on ' + this.fmtDate(this.ToDate) + ':');
        lines.push('');
        lines.push('  Outstanding balance : Rs. ' + this.fmtINR(r.OUTSTANDING));
        lines.push('  Overdue (past due)  : Rs. ' + this.fmtINR(r.OVERDUE));
        if (this.num(r.CREDIT_PERIOD) > 0) {
            lines.push('  Agreed credit period: ' + r.CREDIT_PERIOD + ' days');
        }
        if (age) {
            lines.push('');
            lines.push('Ageing of the outstanding amount:');
            const buckets = [
                ['0-30 days', age.DAYS_000_030], ['31-60 days', age.DAYS_031_060],
                ['61-90 days', age.DAYS_061_090], ['91-120 days', age.DAYS_091_120],
                ['121-180 days', age.DAYS_121_180], ['181-365 days', age.DAYS_181_365],
                ['Over 1 year', this.num(age.DAYS_366_730) + this.num(age.DAYS_731_1095) + this.num(age.DAYS_1096_9999)]
            ];
            for (const b of buckets) {
                if (this.num(b[1]) > 0.01) {
                    lines.push('  ' + (b[0] + '              ').substring(0, 14) + ': Rs. ' + this.fmtINR(b[1]));
                }
            }
        }
        lines.push('');
        lines.push('We request you to kindly arrange payment at the earliest. If payment has');
        lines.push('already been made, please share the details so we can update our records.');
        lines.push('');
        lines.push('Thanks and regards,');
        lines.push('Accounts Department');
        lines.push(this.cmpnyname || '');
        this.ReminderText = lines.join(nl);
        this.ReminderOpen = true;
    }

    CloseReminder() { this.ReminderOpen = false; this.ReminderClient = null; }

    /* mailto URLs truncate around ~2,000 encoded chars in Outlook; past ~1,800 the
       button is disabled and the user is steered to Copy instead */
    ReminderTooLong(): boolean {
        return encodeURIComponent(this.ReminderText).length + encodeURIComponent(this.ReminderSubject).length > 1800;
    }

    SendReminderMail() {
        if (this.ReminderTooLong()) { return; }
        window.location.href = 'mailto:?subject=' + encodeURIComponent(this.ReminderSubject)
            + '&body=' + encodeURIComponent(this.ReminderText);
    }

    CopyReminder(area: HTMLTextAreaElement) {
        area.select();
        try {
            document.execCommand('copy');
            this._toasterService.toast('success', 'success', 'Reminder copied - paste it into your email.');
        } catch (e) {
            this._toasterService.toast('error', 'error', 'Copy failed - please select the text and copy manually.');
        }
        area.setSelectionRange(0, 0);
    }

    fmtINR(v): string {
        const n = this.num(v);
        return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    cacheAge(): string {
        if (!this.CacheInfo) { return ''; }
        const s = this.num(this.CacheInfo.AGE_SECONDS);
        if (s < 90) { return 'just now'; }
        if (s < 5400) { return Math.round(s / 60) + ' min ago'; }
        return (s / 3600).toFixed(1) + ' h ago';
    }

    funnelWidth(f: any): number {
        const p = this.num(f.PCT_OF_FIRST);
        return Math.max(12, Math.min(100, p));
    }

    /* ---- job-level drills (Job Profit grain) ---- */
    ToggleMargin(code: string) { this.MarginOpen[code] = !this.MarginOpen[code]; }
    ToggleUnbilled(jobno: string) { this.UnbilledOpen[jobno] = !this.UnbilledOpen[jobno]; }

    /* jobs behind one Margin row: same client AND same service type (the template
       passes both; filtering by client alone repeated every job under every type) */
    JobsFor(client: string, svc?: string): any[] {
        const t = (svc || '').toUpperCase().trim();
        /* children follow the parent: Last Billed newest first (or oldest first if the
           header arrow is flipped); never-billed jobs sink to the bottom, by job date */
        const dir = (this.MarginSortKey === 'LAST_BILLED_YMD') ? this.MarginSortDir : -1;
        return this.JobRowsFor(client)
            .filter(j => !t || (j.SERVICE_TYPE || '').toUpperCase().trim() === t)
            .sort((a, b) => {
                const ab = this.ymd(a.LAST_BILLED), bb = this.ymd(b.LAST_BILLED);
                if (ab && !bb) { return -1; }
                if (!ab && bb) { return 1; }
                const r = ab.localeCompare(bb) * dir;
                return r || this.ymd(a.JOB_DATE).localeCompare(this.ymd(b.JOB_DATE)) * dir
                         || (a.JOBNO || '').localeCompare(b.JOBNO || '');
            });
    }
    /*  The jobs under a Margin row. In the Shipper view that is simply the job's own P&L.
        In the Billed-party view a job billed to several parties shows THIS client's share:
        its own invoices as income, and the cost of the charges it was billed for (Table13,
        split in the procedure). SPLIT tells the row how many parties share the job.     */
    private JobRowsFor(client: string): any[] {
        if (this.MarginBy === 'SHIPPER' || !this.JobSplit.length) {
            const key = this.MarginKey();
            return this.JobPL.filter(j => (j[key] || j.CLIENTCODE) === client);
        }
        const jobs: any = {};
        this.JobPL.forEach(j => { jobs[(j.JOBNO || '').toString().trim()] = j; });
        return this.JobSplit
            .filter(s => s.CLIENTCODE === client)
            .map(s => {
                const j = jobs[(s.JOBNO || '').toString().trim()] || {};
                return Object.assign({}, j, {
                    JOBNO: s.JOBNO,
                    INCOME: s.INCOME, EXPENSE: s.EXPENSE, PROFIT: s.PROFIT, PROFIT_PCT: s.PROFIT_PCT,
                    LAST_BILLED: s.LAST_BILLED || j.LAST_BILLED,
                    SPLIT: this.num(s.CLIENTS_ON_JOB), UNMATCHED: this.num(s.UNMATCHED_COST),
                    JOB_INCOME: j.INCOME, JOB_EXPENSE: j.EXPENSE
                });
            });
    }

    /* dd/MM/yyyy -> yyyyMMdd so job dates sort chronologically */
    private ymd(d: string): string {
        const s = (d || '').toString();
        return s.length === 10 ? s.substr(6, 4) + s.substr(3, 2) + s.substr(0, 2) : s;
    }
    /* voucher lines under an unbilled job: by voucher date, then type, then number */
    LinesFor(jobno: string): any[] {
        return this.UnbilledLines.filter(l => l.JOBNO === jobno)
            .sort((a, b) => this.ymd(a.REF_DATE).localeCompare(this.ymd(b.REF_DATE))
                || (a.VCH_TYPE || a.SOURCE_ || '').localeCompare(b.VCH_TYPE || b.SOURCE_ || '')
                || (a.REFNO || '').localeCompare(b.REFNO || ''));
    }

    /* ---- Margin table sort: default most recently billed client x service first; click a header to change ---- */
    MarginSortKey = 'LAST_BILLED_YMD';
    MarginSortDir = -1;           // 1 asc, -1 desc
    SortMargin(key: string) {
        if (this.MarginSortKey === key) { this.MarginSortDir = -this.MarginSortDir; }
        else {
            this.MarginSortKey = key;
            /* text columns start ascending, figures start with the biggest first */
            this.MarginSortDir = (key === 'CLIENTNAME' || key === 'SERVICE_TYPE') ? 1 : -1;
        }
        this.marginPager.set(this.MarginSorted());
    }
    sortArrow(key: string): string {
        return this.MarginSortKey === key ? (this.MarginSortDir === 1 ? '▲' : '▼') : '';
    }
    MarginSorted(): any[] {
        const k = this.MarginSortKey, d = this.MarginSortDir;
        const text = (k === 'CLIENTNAME' || k === 'SERVICE_TYPE' || k === 'LAST_BILLED_YMD');
        return this.MarginRows().slice().sort((a, b) => {
            let r: number;
            if (text) {
                const av = (k === 'SERVICE_TYPE' ? this.svcLabel(a[k]) : (a[k] || '')).toString().toUpperCase();
                const bv = (k === 'SERVICE_TYPE' ? this.svcLabel(b[k]) : (b[k] || '')).toString().toUpperCase();
                r = av < bv ? -1 : av > bv ? 1 : 0;
            } else {
                r = this.num(a[k]) - this.num(b[k]);
            }
            if (r === 0 && k !== 'CLIENTNAME') {           /* stable secondary: client A-Z */
                const an = (a.CLIENTNAME || '').toUpperCase(), bn = (b.CLIENTNAME || '').toUpperCase();
                return an < bn ? -1 : an > bn ? 1 : 0;
            }
            if (r === 0 && k === 'CLIENTNAME') {           /* then service type */
                const as = this.svcLabel(a.SERVICE_TYPE), bs = this.svcLabel(b.SERVICE_TYPE);
                return as < bs ? -1 : as > bs ? 1 : 0;
            }
            return r * d;
        });
    }

    /* ---- Unbilled table sort: default OLDEST first (a billing worklist), then biggest cost ---- */
    UnbilledSortKey = 'AGE_DAYS';
    UnbilledSortDir = -1;
    SortUnbilled(key: string) {
        if (this.UnbilledSortKey === key) { this.UnbilledSortDir = -this.UnbilledSortDir; }
        else {
            this.UnbilledSortKey = key;
            const text = (key === 'JOBNO' || key === 'MODE_' || key === 'CLIENTNAME' || key === 'JOB_DATE');
            this.UnbilledSortDir = text ? 1 : -1;      /* text & date ascending, figures biggest first */
        }
        this.unbilledPager.set(this.UnbilledSorted());
    }
    usortArrow(key: string): string {
        return this.UnbilledSortKey === key ? (this.UnbilledSortDir === 1 ? '▲' : '▼') : '';
    }
    UnbilledSorted(): any[] {
        const k = this.UnbilledSortKey, d = this.UnbilledSortDir;
        const text = (k === 'JOBNO' || k === 'MODE_' || k === 'CLIENTNAME' || k === 'JOB_DATE');
        return (this.UnbilledJobs || []).slice().sort((a, b) => {
            let r: number;
            if (k === 'JOB_DATE') { r = this.ymd(a.JOB_DATE).localeCompare(this.ymd(b.JOB_DATE)); }
            else if (text) {
                const av = (a[k] || '').toString().toUpperCase(), bv = (b[k] || '').toString().toUpperCase();
                r = av < bv ? -1 : av > bv ? 1 : 0;
            } else { r = this.num(a[k]) - this.num(b[k]); }
            if (r !== 0) { return r * d; }
            /* tie-breakers: biggest cost, then oldest */
            return (this.num(b.TOTAL_COST) - this.num(a.TOTAL_COST))
                || (this.num(b.AGE_DAYS) - this.num(a.AGE_DAYS));
        });
    }

    /* ERP voucher-type abbreviations -> full name (tooltip on the voucher chip) */
    vchName(t: string): string {
        switch ((t || '').toUpperCase().trim()) {
            case 'II': return 'Invoice';
            case 'SI': return 'Storage Invoice';
            case 'BI': return 'Brokerage Invoice';
            case 'CN': return 'Credit Note';
            case 'PI': return 'Purchase Invoice';
            case 'BP': return 'Bank Payment';
            case 'BR': return 'Bank Receipt';
            case 'CP': return 'Cash Payment';
            case 'CR': return 'Cash Receipt';
            case 'CE': return 'Cash Expense';
            case 'JV': return 'Journal Voucher';
            default:   return t;
        }
    }

    /* service-type codes from the proc -> one consistent "Name (CODE)" label everywhere:
       FFD = Freight Forwarding, CCLR = Custom Clearance, EX = Exwork */
    svcLabel(t: string): string {
        switch ((t || '').toUpperCase().trim()) {
            case 'FFD':      case 'FREIGHT FORWARDING': return 'Freight Forwarding (FFD)';
            case 'CCLR':     case 'CUSTOM CLEARANCE':   return 'Custom Clearance (CCLR)';
            case 'EX':       case 'EXWORK':             return 'Exwork (EX)';
            case 'FFD+CCLR': case 'FFD + CCLR':         return 'Freight Forwarding + Custom Clearance (FFD+CCLR)';
            case 'MISC':     case 'MISC / OTHER':       return 'Misc / Other';
            case 'UNCLASS':  case 'UNCLASSIFIED':       return 'Unclassified';
            default:                                    return t;
        }
    }

    /* job number click -> in-page drawer (stays on the dashboard). One call, the same one
       the Account-Job-Profit-Report popup makes; shows the heads only - the Window button
       opens the full voucher-level page. */
    OpenJobDrawer(jobno: string) {
        const no = String(jobno || '').replace(/^'/, '').trim();
        if (!no) { return; }
        this.JobDrawerNo = no;
        this.JobLoading = true;
        this.JobFailed = false;
        this.JobInfo = {};
        this.JobHeads = [];
        this.JobIncome = 0;
        this.JobExpense = 0;
        this._dataService.getData('Accounts/ACC_RPT_JOBPROFITS_JOBWISE', { JOBNO: no })
            .subscribe((data: any) => {
                if (this.JobDrawerNo !== no) { return; }      // closed, or another job opened meanwhile
                this.JobLoading = false;
                if (!data || !data.Table || data.Table.length === 0) { this.JobFailed = true; this.repaint(); return; }
                this.JobInfo = (data.Table1 && data.Table1.length) ? data.Table1[0] : {};
                this.JobHeads = data.Table2 || [];
                const g = (data.Table4 && data.Table4.length) ? data.Table4[0] : {};
                /* GRAND_DIFFAMT is unsigned in the proc; profit = income - expense, signed */
                this.JobIncome = this.num(g.GRAND_RECOVERYAMT);
                this.JobExpense = this.num(g.GRAND_PAIDAMT);
                this.repaint();
            }, () => {
                if (this.JobDrawerNo !== no) { return; }
                this.JobLoading = false;
                this.JobFailed = true;
                this.repaint();
            });
    }
    CloseJobDrawer() { this.JobDrawerNo = null; this.JobLoading = false; }
    JobProfit(): number { return this.JobIncome - this.JobExpense; }
    JobMarginPct(): number { return this.JobIncome !== 0 ? this.JobProfit() / this.JobIncome * 100 : null; }
    JobHeadDiff(g: any): number { return this.num(g.RECOVERYAMT) - this.num(g.PAIDAMT); }
    JobClient(): string {
        const t = (v) => (v === null || v === undefined) ? '' : v.toString().trim();
        return t(this.JobInfo.EXP_NAME) || t(this.JobInfo.BILLTO_NAME) || t(this.JobInfo.EXPORTER_NAME) || '-';
    }

    /* full voucher-level statement for one job - the existing Job Profit popup page */
    OpenJobPopup(jobno: string) {
        const theTop = (screen.height / 2) - (483 / 2);
        const theLeft = (screen.width / 2) - (780 / 2);
        const toolbar = 'resizable=no,scrollbars=yes,width=800,height=450,status=no,left=' + theLeft + ',top=' + theTop;
        window.open('./#/popup/Account-Job-Profit-Report/' + String(jobno).replace(/^'/, '') + '/', 'Job Profit Report', toolbar);
    }

    Reset() {
        const today = new Date();
        const fyStartYear = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
        this.FromDate = this._dataService.datechnge(new Date(fyStartYear, 3, 1));
        this.ToDate = this._dataService.datechnge(today);
        this.Branch = this._loginService.getLogin()[0].CITYCODE1;
        this.ClientCode = null;
        this.ClientQuery = '';
        this.TopN = 10;
        this.Searched = false;
        this.Tab = 'RECEIVABLES';
        this.RefAuditOpen = false;
        this.DrillClient = null;
    }

    /* ---- helpers ---- */
    num(v): number {
        const n = parseFloat(v);
        return isNaN(n) ? 0 : n;
    }

    shortName(n: string): string {
        if (!n) { return ''; }
        return n.length > 18 ? n.substring(0, 18) + '..' : n;
    }

    /* compact Indian display for the KPI cards: 1,23,45,678 -> 1.23 Cr */
    /** KPI tile: number and unit split so the unit is set smaller (display only). */
    fig(s: any) { return finFigure(s); }

    fmtShort(v): string {
        const n = this.num(v);
        const a = Math.abs(n);
        const sign = n < 0 ? '-' : '';
        if (a >= 10000000) { return sign + (a / 10000000).toFixed(2) + ' Cr'; }
        if (a >= 100000) { return sign + (a / 100000).toFixed(2) + ' L'; }
        return sign + a.toFixed(0);
    }

    pillClass(status: string): string {
        switch (status) {
            case 'RED': return 'fd-pill--red';
            case 'AMBER': return 'fd-pill--amber';
            case 'GREEN': return 'fd-pill--green';
            default: return 'fd-pill--grey';
        }
    }

    meterClass(status: string): string {
        switch (status) {
            case 'RED': return 'bad';
            case 'AMBER': return 'warn';
            case 'GREEN': return 'ok';
            default: return '';
        }
    }

    iconClass(status: string): string {
        switch (status) {
            case 'RED': return 'fd-ico--red';
            case 'AMBER': return 'fd-ico--amber';
            case 'GREEN': return 'fd-ico--green';
            default: return 'fd-ico--blue';
        }
    }

    /* width of the utilisation bar, capped so a 400% client does not overflow the cell */
    utilWidth(v): number {
        const n = this.num(v);
        return n > 100 ? 100 : (n < 0 ? 0 : n);
    }

    pctOf(part, whole): number {
        const w = this.num(whole);
        if (w <= 0) { return 0; }
        const p = this.num(part) / w * 100;
        return p > 100 ? 100 : (p < 0 ? 0 : p);
    }

    taxablePct(): number {
        if (!this.Kpi) { return 0; }
        const tax = this.num(this.Kpi.TAXABLE_INR) + this.num(this.Kpi.TAXABLE_FX_INR);
        const all = tax + this.num(this.Kpi.NONTAXABLE_INR) + this.num(this.Kpi.NONTAXABLE_FX_INR);
        return all > 0 ? tax / all * 100 : 0;
    }

    deltaArrow(v): string {
        const n = this.num(v);
        return n > 0 ? '↗' : (n < 0 ? '↘' : '→');
    }

    /* ======================= Outstanding card ======================= */
    /*  Outstanding is a position AS ON the To date, so it carries unpaid bills from
        every year - on Links about 20cr of the 43cr pending was raised before the
        current financial year. People read the date filter as "this period", so the
        card splits Bills pending into what was raised inside the selected dates and
        what is older. Hidden until the proc returns PENDING_PERIOD.                   */
    HasPeriodSplit(): boolean {
        const k: any = this.Kpi || {};
        return k.PENDING_PERIOD !== undefined && k.PENDING_PERIOD !== null;
    }
    PendingPeriod(): number { return this.num((this.Kpi || {} as any).PENDING_PERIOD); }
    PendingOlder(): number { return this.num((this.Kpi || {} as any).GROSS_PENDING) - this.PendingPeriod(); }
    FromLabel(): string { return this.fmtDate(this.FromDate); }
    /* the client holding the most credit beyond its open bills - named in the explainer */
    BiggestLeftOver(): string {
        let best: any = null, bestAmt = 0;
        (this.Exposure || []).forEach((r: any) => {
            const x = this.num(r.UNADJUSTED) - this.num(r.GROSS_PENDING);
            if (x > bestAmt) { bestAmt = x; best = r; }
        });
        return best ? best.CLIENTNAME + ' ' + this.fmtShort(bestAmt) : '';
    }

    /*  The Outstanding card used to print "Bills pending" and "Unapplied credit" next to
        each other, and the two do not subtract to the headline - credit is netted PER
        CLIENT in the proc, so a customer holding more credit than open bills cannot pay
        off anybody else's bills. Split the credit into the part that actually knocked
        bills off (this always reconciles: pending - applied = outstanding) and the part
        left stranded. Computed here as well as in the proc, so the screen reads right
        whichever order the build and the SQL are deployed in.                          */
    CreditApplied(): number {
        const k: any = this.Kpi || {};
        if (k.CREDIT_APPLIED !== undefined && k.CREDIT_APPLIED !== null) { return +k.CREDIT_APPLIED; }
        return (+k.GROSS_PENDING || 0) - (+k.TOTAL_OUTSTANDING || 0);
    }

    /*  Part of the credit above that is credit notes nobody linked to an invoice. The
        note is real money owed to the client, but with no link the bill behind it stays
        open for ever - Links Mumbai carried 93.66 lakh of these, 52.81 lakh of it on one
        client whose Account Statement showed the account square. Shown on its own line so
        Accounts can see what to go back and attach.  */
    CnUnlinked(): number {
        const k: any = this.Kpi || {};
        return +k.CN_UNLINKED || 0;
    }

    CreditStranded(): number {
        const k: any = this.Kpi || {};
        if (k.CREDIT_STRANDED !== undefined && k.CREDIT_STRANDED !== null) { return +k.CREDIT_STRANDED; }
        return (+k.UNADJUSTED_CREDITS || 0) - this.CreditApplied();
    }

    /* ======================= KPI card -> the rows behind its figure ======================= */
    /*  A figure a person can click through to a named client, a job number and an amount
        is a figure they can check against their own register. Clicking a KPI card opens
        the actual rows that add up to it, straight from the result sets already on the
        page - no extra call, no new proc. Ten rows are shown; Export writes the full list. */
    ExplainKey: string = null;
    EvidenceAll = false;
    OpenExplain(key: string) { this.ExplainKey = key; this.EvidenceAll = false; }
    CloseExplain() { this.ExplainKey = null; }
    ToggleEvidenceAll() { this.EvidenceAll = !this.EvidenceAll; }

    private evidenceDef(): any {
        const k = this.ExplainKey;
        const exposure = this.Exposure || [];
        const by = (arr: any[], f: string) => arr.slice().sort((a, b) => this.num(b[f]) - this.num(a[f]));
        switch (k) {
            case 'EXPOSURE': return {
                title: 'Total exposure',
                note: 'Every client with money at stake, biggest first. Outstanding is what is billed and unpaid; '
                    + 'Unbilled is cost booked on jobs not yet invoiced. The two added together is the exposure on the card.',
                cols: [{ k: 'CLIENTNAME', label: 'Client' },
                       { k: 'OUTSTANDING', label: 'Outstanding', num: true },
                       { k: 'UNBILLED', label: 'Unbilled', num: true },
                       { k: 'TOTAL_EXPOSURE', label: 'Total exposure', num: true }],
                rows: by(exposure, 'TOTAL_EXPOSURE'), totalKey: 'TOTAL_EXPOSURE', totalLabel: 'Total exposure',
                file: 'Exposure'
            };
            case 'OUTSTANDING': return {
                title: 'Outstanding (net)',
                note: 'Bill-wise pending per client, less the on-account credit set against that same client. '
                    + 'Credit is never moved from one client to another, which is why the column does not simply subtract across the page.',
                cols: [{ k: 'CLIENTNAME', label: 'Client' },
                       { k: 'PENDING_PERIOD', label: 'Raised in dates', num: true },
                       { k: 'GROSS_PENDING', label: 'Bills pending', num: true },
                       { k: 'UNADJUSTED', label: 'Credit on account', num: true },
                       { k: 'OUTSTANDING', label: 'Outstanding', num: true },
                       { k: 'OVERDUE', label: 'Overdue', num: true }],
                rows: by(exposure, 'OUTSTANDING'), totalKey: 'OUTSTANDING', totalLabel: 'Outstanding',
                file: 'Outstanding'
            };
            case 'RECOVERY': return {
                title: 'Recovery',
                note: 'How long each client actually takes to pay, against the credit period agreed with them. '
                    + 'The card shows the value-weighted average, so a large slow client counts more than a small one.',
                cols: [{ k: 'CLIENTNAME', label: 'Client' },
                       { k: 'CREDIT_PERIOD', label: 'Credit days', num: true },
                       { k: 'ACTUAL_DAYS_WTD', label: 'Actual days', num: true },
                       { k: 'RECOVERY_GAP', label: 'Gap', num: true },
                       { k: 'BILLED_AMT', label: 'Billed in period', num: true }],
                rows: by(this.Recovery || [], 'BILLED_AMT'), totalKey: 'BILLED_AMT', totalLabel: 'Billed in period',
                file: 'Recovery'
            };
            case 'BILLED': return {
                title: 'Billed in period',
                note: 'Invoice value raised in the selected period, client by client. This is the bill value, '
                    + 'not what has been collected - collection is on the Recovery card.',
                cols: [{ k: 'CLIENTNAME', label: 'Client' },
                       { k: 'BILLED_PERIOD', label: 'Billed in period', num: true },
                       { k: 'OUTSTANDING', label: 'Still outstanding', num: true }],
                rows: by(exposure, 'BILLED_PERIOD').filter(r => this.num(r.BILLED_PERIOD) > 0),
                totalKey: 'BILLED_PERIOD', totalLabel: 'Billed in period', file: 'Billed'
            };
            case 'UNBILLED': return {
                title: 'Unbilled (cost)',
                note: 'Each job that has cost booked against it but no invoice yet. Every rupee here is our money '
                    + 'until the bill goes out. Open the Unbilled tab to see the voucher lines behind a job.',
                cols: [{ k: 'JOBNO', label: 'Job no' },
                       { k: 'CLIENTNAME', label: 'Client' },
                       { k: 'JOB_DATE', label: 'Job date' },
                       { k: 'AGE_DAYS', label: 'Age (days)', num: true },
                       { k: 'TOTAL_COST', label: 'Cost booked', num: true }],
                rows: by(this.UnbilledJobs || [], 'TOTAL_COST'), totalKey: 'TOTAL_COST', totalLabel: 'Cost booked',
                file: 'Unbilled'
            };
            case 'MARGIN': return {
                title: 'Margin',
                note: 'Income less job cost from the ledger, by client and type of work - the same rows as the Margin tab, '
                    + 'grouped by ' + (this.MarginBy === 'SHIPPER' ? 'the shipper.' : 'the party that was billed.'),
                cols: [{ k: 'CLIENTNAME', label: this.MarginBy === 'SHIPPER' ? 'Shipper' : 'Client (billed)' },
                       { k: 'SERVICE_TYPE', label: 'Service' },
                       { k: 'REVENUE', label: 'Income', num: true },
                       { k: 'COST', label: 'Expense', num: true },
                       { k: 'MARGIN', label: 'Margin', num: true }],
                rows: by(this.MarginRows(), 'REVENUE'), totalKey: 'MARGIN', totalLabel: 'Margin',
                file: 'Margin'
            };
            default: return null;
        }
    }

    Evidence(): any {
        const d = this.evidenceDef();
        if (!d || !d.rows || d.rows.length === 0) { return null; }
        d.count = d.rows.length;
        d.total = d.rows.reduce((s: number, r: any) => s + this.num(r[d.totalKey]), 0);
        d.shown = this.EvidenceAll ? d.rows : d.rows.slice(0, 10);
        return d;
    }

    /* the full list, not the ten on screen */
    /*  With one client selected, the Outstanding export is the proof rather than the
        summary: every open bill, then every credit set against it, in one sheet that
        subtracts to the figure on the card.  */
    private outstandingProof(): any {
        if (this.ExplainKey !== 'OUTSTANDING' || !this.OsBills.length) { return null; }
        const rows: any[] = [];
        this.OsBills.forEach(b => rows.push([
            b.KIND_, '', b.INV_NO, b.INV_DATE, b.DUE_DATE,
            this.num(b.DAYS_OVERDUE) > 0 ? this.num(b.DAYS_OVERDUE) : '',
            this.num(b.BILL_AMT), this.num(b.RECEIVED), this.num(b.PENDING), '']));
        const billed = this.OsBills.reduce((s, b) => s + this.num(b.PENDING), 0);
        rows.push(['BILLS PENDING - TOTAL', '', '', '', '', '', '', '', billed, '']);
        rows.push(['', '', '', '', '', '', '', '', '', '']);
        this.OsCredits.forEach(c => rows.push([
            c.CATEGORY, c.VCH_TYPE, c.REFNO, c.REF_DATE, '', '', '', '', '',
            this.num(c.AMOUNT)]));
        const cred = this.OsCredits.reduce((s, c) => s + this.num(c.AMOUNT), 0);
        rows.push(['CREDIT APPLIED - TOTAL', '', '', '', '', '', '', '', '', cred]);
        rows.push(['', '', '', '', '', '', '', '', '', '']);
        rows.push(['OUTSTANDING (bills pending less credit)', '', '', '', '', '', '', '',
                   billed - cred, '']);
        return {
            headers: ['Section', 'Type', 'Reference', 'Date', 'Due date', 'Days late',
                      'Bill amount', 'Received', 'Pending', 'Credit'],
            rows: rows,
            file: 'Outstanding_proof'
        };
    }

    /*  One sheet per client is the proof of a client's figure; this is the proof of the
        whole card. Fetched only when asked for - it is 5,000+ bills on Links, which has
        no business riding on every page load.
        Credit is capped at each client's own bills, because the card floors every client
        at zero: one client's surplus never pays another's dues. Capped this way the
        OUTSTANDING lines add up to the card exactly.  */
    ExportAllBills() {
        if (this.AllBillsBusy) { return; }
        this.AllBillsBusy = true;
        this._dataService.getData('Accounts/ACC_RPT_FINANCE_DASHBOARD', {
            FROMDATE: this.fmtDate(this.FromDate),
            TODATE: this.fmtDate(this.ToDate),
            CMPCODE: this._loginService.getLogin()[0].CMPCODE,
            CITYCODE: this.Branch,
            CLIENTCODE: 'ALL-BILLS',
            TOPN: this.TopN
        }).subscribe((data: any) => {
            this.AllBillsBusy = false;
            const bills = (data && data.Table17) ? data.Table17 : [];
            const creds = (data && data.Table18) ? data.Table18 : [];
            if (!bills.length) {
                this._toasterService.toast('warning', 'warning', 'Nothing to export !');
                return;
            }
            const byClient: any = {};
            const order: string[] = [];
            const slot = (code: string, name: string) => {
                if (!byClient[code]) { byClient[code] = { name: name, bills: [], creds: [] }; order.push(code); }
                return byClient[code];
            };
            bills.forEach(b => slot(b.CLIENTCODE, b.CLIENTNAME).bills.push(b));
            creds.forEach(c => slot(c.CLIENTCODE, c.CLIENTNAME).creds.push(c));

            const rows: any[] = [];
            let gTotal = 0;
            order.forEach(code => {
                const g = byClient[code];
                const billed = g.bills.reduce((s: number, b: any) => s + this.num(b.PENDING), 0);
                const credit = g.creds.reduce((s: number, c: any) => s + this.num(c.AMOUNT), 0);
                const used = credit > billed ? billed : credit;
                const net = billed - used > 0 ? billed - used : 0;
                gTotal += net;
                g.bills.forEach((b: any) => rows.push([g.name, code, b.KIND_, '', b.INV_NO, b.INV_DATE,
                    b.DUE_DATE, this.num(b.DAYS_OVERDUE) > 0 ? this.num(b.DAYS_OVERDUE) : '',
                    this.num(b.BILL_AMT), this.num(b.RECEIVED), this.num(b.PENDING), '']));
                rows.push([g.name, code, 'BILLS PENDING - TOTAL', '', '', '', '', '', '', '', billed, '']);
                g.creds.forEach((c: any) => rows.push([g.name, code, c.CATEGORY, c.VCH_TYPE, c.REFNO,
                    c.REF_DATE, '', '', '', '', '', this.num(c.AMOUNT)]));
                if (credit > billed) {
                    rows.push([g.name, code, 'CREDIT APPLIED (capped at this client\'s bills)',
                               '', '', '', '', '', '', '', '', used]);
                    rows.push([g.name, code, 'CREDIT LEFT OVER (cannot pay another client)',
                               '', '', '', '', '', '', '', '', credit - used]);
                } else if (credit > 0) {
                    rows.push([g.name, code, 'CREDIT APPLIED - TOTAL', '', '', '', '', '', '', '', '', credit]);
                }
                rows.push([g.name, code, 'OUTSTANDING', '', '', '', '', '', '', '', net, '']);
                rows.push(['', '', '', '', '', '', '', '', '', '', '', '']);
            });
            rows.push(['ALL CLIENTS', '', 'OUTSTANDING - TOTAL', '', '', '', '', '', '', '', gTotal, '']);

            this.exportser.exportExceltry({
                data: rows,
                headers: ['Client', 'Code', 'Section', 'Type', 'Reference', 'Date', 'Due date',
                          'Days late', 'Bill amount', 'Received', 'Pending', 'Credit'],
                pagetype: 'FinanceDashboard', title: this.cmpnyname,
                subtitle: 'Every bill and every credit behind Outstanding - ' + this.BranchLabel
                    + ' - as on ' + this.fmtDate(this.ToDate)
            }, 'FinanceDashboard_Outstanding_all_bills_');
        }, () => {
            this.AllBillsBusy = false;
            this._toasterService.toast('error', 'error', 'The full list could not be loaded.');
        });
    }

    ExportEvidence() {
        const proof = this.outstandingProof();
        if (proof) {
            this.exportser.exportExceltry({
                data: proof.rows, headers: proof.headers, pagetype: 'FinanceDashboard',
                title: this.cmpnyname,
                subtitle: 'How Outstanding is made up - ' + this.ClientLabel() + ' - '
                    + this.BranchLabel + ' - as on ' + this.fmtDate(this.ToDate)
            }, 'FinanceDashboard_Outstanding_proof_');
            return;
        }
        const d = this.evidenceDef();
        if (!d || !d.rows.length) { this._toasterService.toast('warning', 'warning', 'Nothing to export !'); return; }
        const headers = d.cols.map((c: any) => c.label);
        const rows = d.rows.map((r: any) => d.cols.map((c: any) => r[c.k]));
        this.exportser.exportExceltry({
            data: rows, headers: headers, pagetype: 'FinanceDashboard', title: this.cmpnyname,
            subtitle: d.file + ' behind the ' + this.ExplainKey + ' figure - ' + this.BranchLabel + ' - '
                + this.fmtDate(this.FromDate) + ' to ' + this.fmtDate(this.ToDate)
        }, 'FinanceDashboard_' + d.file + '_');
    }

    /*  Outstanding split by the financial year the bill was raised in. Unapplied client
        credit is set against the oldest year first - client by client - so the years add
        back to the Outstanding and Overdue on the cards above.  */
    OpenFy(y: any) {
        this.FyOpen = this.num(y.FY_START);
        this.FyLabel = y.FY;
        this.FyRow = y;
        this.LoadFyDetail();
    }

    CloseFy() { this.FyOpen = null; }

    UnmLinesFor(j: any): any[] {
        if (!j || !this.UnmLinesAll.length) { return []; }
        const job = (j.JOBNO || '').toString().trim();
        const cl = (j.CLIENTCODE || '').toString().trim();
        return this.UnmLinesAll.filter(r => (r.JOBNO || '').toString().trim() === job
                                         && (r.CLIENTCODE || '').toString().trim() === cl);
    }

    UnmTotal(j: any): number {
        return this.UnmLinesFor(j).reduce((s, r) => s + this.num(r.SHARE), 0);
    }

    /*  With a client already selected the lines are in hand, so open at once. Otherwise
        re-run scoped to that client - the only way to get the lines without putting them
        on every page load - and open when the data lands.  */
    OpenUnm(j: any, ev: any) {
        if (ev) { ev.stopPropagation(); }
        if (this.UnmLinesFor(j).length) { this.UnmJob = j; return; }
        this.UnmPending = (j.JOBNO || '').toString().trim();
        this.LoadClient((j.CLIENTCODE || '').toString().trim());
    }

    CloseUnm() { this.UnmJob = null; }

    LoadFyDetail() {
        if (this.FyDetail || this.FyBusy) { return; }
        this.FyBusy = true;
        this.FyError = '';
        this._dataService.getData('Accounts/ACC_RPT_ACCOUNTS_HOME_DRILL', {
            CMPCODE: this._loginService.getLogin()[0].CMPCODE,
            CITYCODE: this.Branch,
            KIND: 'OVERDUE',
            ASOF: ''
        }).subscribe((data: any) => {
            this.FyBusy = false;
            const ok = data && data.Table && data.Table.length > 0 && data.Table[0].STATUS == '100';
            if (!ok) { this.FyError = 'The client detail could not be loaded.'; return; }
            this.FyClients = data.Table6 || [];
            this.FyDetail = true;
        }, () => { this.FyBusy = false; this.FyError = 'The client detail could not be loaded.'; });
    }

    FyClientsFor(y: any): any[] {
        const n = this.num(y);
        return this.FyClients.filter(c => this.num(c.FY_START) === n);
    }

    /* full-rupee figure for the arithmetic lines (the cards show the short form) */
    fmtRs(v): string { return 'Rs. ' + this.fmtINR(v); }

    /* Builds the explanation for the open card from the live KPI row, so the
       arithmetic a layman sees is exactly the numbers on the card. */
    explain(key: string = this.ExplainKey): any {
        const k = this.Kpi || {};
        const p = this.PayKpi || {};      // PAYABLES cards read their own KPI row
        const n = (v) => this.num(v);
        const period = this.fmtDate(this.FromDate) + ' to ' + this.fmtDate(this.ToDate);
        const asOn = this.fmtDate(this.ToDate);
        switch (key) {
            case 'EXPOSURE': return {
                title: 'Total Exposure',
                what: 'All the money currently tied up with customers: what they owe us on bills, plus the cost we have already '
                    + 'spent on jobs that have not been invoiced yet. It is the true credit risk, as on ' + asOn + '.',
                steps: [
                    { op: '',  label: 'Outstanding (net, what customers owe us)', value: this.fmtRs(k.TOTAL_OUTSTANDING) },
                    { op: '+', label: 'Unbilled (cost on jobs not yet invoiced)', value: this.fmtRs(k.UNBILLED_VALUE) }
                ],
                result: { label: 'Total Exposure', value: this.fmtRs(k.TOTAL_EXPOSURE), short: this.fmtShort(k.TOTAL_EXPOSURE) },
                source: 'Outstanding comes from the invoice register less bill-wise receipts (acc_invoice, acc_bankdtls "AB" lines). '
                    + 'Unbilled is the purchase / payment / JV cost booked on jobs that have no invoice yet.',
                notes: ['Always greater than or equal to Outstanding.',
                        'Unbilled is cost, not the bill value - the real amount at stake is higher.']
            };
            case 'OUTSTANDING': return {
                title: 'Outstanding (net)',
                what: 'What customers still owe us today. We start from the bills that are not knocked off, then deduct the money '
                    + 'customers have paid on account (received, but never matched to a specific bill).',
                steps: (this.HasPeriodSplit() ? [
                    { op: '',  label: 'Bills raised in the selected dates (' + period + '), still unpaid', value: this.fmtRs(this.PendingPeriod()) },
                    { op: '+', label: 'Older bills raised before ' + this.FromLabel() + ', still unpaid', value: this.fmtRs(this.PendingOlder()) },
                    { op: '=', label: 'Bills pending (bill value not yet knocked off)', value: this.fmtRs(k.GROSS_PENDING) }
                ] : [
                    { op: '',  label: 'Bills pending (bill value not yet knocked off)', value: this.fmtRs(k.GROSS_PENDING) }
                ]).concat([
                    { op: '-', label: 'Credit applied (on-account money set against open bills of the same client)', value: this.fmtRs(this.CreditApplied()) }
                ]),
                result: { label: 'Outstanding (net)', value: this.fmtRs(k.TOTAL_OUTSTANDING), short: this.fmtShort(k.TOTAL_OUTSTANDING) },
                extra: [
                    { label: 'Credit left over (clients holding more credit than open bills)'
                        + (this.BiggestLeftOver() ? ' - largest: ' + this.BiggestLeftOver() : ''), value: this.fmtRs(this.CreditStranded()) },
                    { op: ' ', label: 'of the credit above, credit notes never linked to an invoice ('
                        + this.num((this.Kpi || {}).CN_UNLINKED_NOTES) + ' notes, '
                        + this.num((this.Kpi || {}).CN_UNLINKED_CLIENTS) + ' clients)', value: this.fmtRs(this.CnUnlinked()) },
                    { label: 'of which Overdue (past the due date)', value: this.fmtRs(k.OVERDUE_AMT) },
                    { label: 'Overdue share of Outstanding', value: this.pctOf(k.OVERDUE_AMT, k.TOTAL_OUTSTANDING).toFixed(0) + ' %' }
                ],
                source: 'A bill counts as paid when a receipt line is entered "Against Bill" (AB) with that bill number. '
                    + 'Receipts entered as GR / OA / AO name no bill, so they sit as unapplied credit and are deducted per client.',
                notes: ['Includes the opening balance brought forward from before the ERP went live'
                            + (this.num(k.OPENING_PENDING) > 0.5 ? ' (' + this.fmtRs(k.OPENING_PENDING) + ' still owed from ' + (k.OPENING_ASOF || 'go-live') + ')' : '')
                            + ', less the receipts entered against it (AO), exactly like the OP. BALANCE line on the Billwise statement.',
                        'Outstanding is what is owed ON the To date, so it includes unpaid bills from earlier years. '
                            + 'The From date only splits it into "raised in the selected dates" and "older".',
                        'Calculated per client and floored at zero - one client\'s surplus credit never offsets another client\'s dues.',
                        'Advances (AD) are kept separate and are not deducted here.',
                        'Due date = invoice date + credit period (see the Recovery card).']
            };
            case 'RECOVERY': return {
                title: 'Recovery (days to get paid)',
                what: 'How many days customers actually take to pay us, for bills raised in ' + period + ' that have been paid. '
                    + 'Big bills count more than small ones (value-weighted), so a few tiny old bills cannot distort the number.',
                steps: [
                    { op: '',  label: 'For each paid bill: days = payment date - invoice date', value: '' },
                    { op: '',  label: 'Weighted average = sum(days x bill amount) / sum(bill amount)', value: n(k.AVG_COLLECTION_DAYS).toFixed(1) + ' days' },
                    { op: '-', label: 'Credit period we agreed (average)', value: n(k.AVG_CREDIT_PERIOD).toFixed(1) + ' days' }
                ],
                result: { label: 'Recovery gap', value: (n(k.RECOVERY_GAP) > 0 ? '+' : '') + n(k.RECOVERY_GAP).toFixed(1) + ' days',
                          short: n(k.RECOVERY_GAP) > 0 ? 'paying LATE' : 'paying early / on time' },
                extra: (k.FASTEST_DAYS === undefined || k.FASTEST_DAYS === null) ? [] : [
                    { label: 'Fastest bill paid: Inv ' + k.FASTEST_INV + ' - ' + k.FASTEST_CLIENT, value: n(k.FASTEST_DAYS).toFixed(0) + ' days' },
                    { label: 'Slowest bill paid: Inv ' + k.SLOWEST_INV + ' - ' + k.SLOWEST_CLIENT, value: n(k.SLOWEST_DAYS).toFixed(0) + ' days' },
                    { label: 'Settled bills the average is built on', value: n(k.SETTLED_BILLS).toLocaleString('en-IN') }
                ],
                source: 'Invoice date from acc_invoice; payment date = the last "Against Bill" receipt for that bill. '
                    + 'Credit period: the bill\'s pay-by date if sensible (1-180 days), else the client master terms (sea / air), else 30 days.',
                notes: ['Positive gap = customers pay later than agreed; negative = earlier.',
                        'Fastest / Slowest are single bills - the quickest and the slowest one settled in the period. Fastest ignores bills paid before they were raised (prepaid).',
                        'Rule of thumb: +10 days on Rs. 70 Cr of yearly billing is about Rs. 2 Cr lent to customers interest-free.',
                        'Clients with no terms on file are measured against 30 days and show as NO-TERMS.']
            };
            case 'BILLED': return {
                title: 'Billed in Period',
                what: 'The value of invoices we raised to customers between ' + period + ', converted to INR.',
                steps: [
                    { op: '',  label: 'Invoices raised in the period', value: n(k.INVOICE_COUNT).toLocaleString('en-IN') + ' invoices' },
                    { op: '',  label: 'Taxable services', value: this.fmtRs(k.TAXABLE_INR) },
                    { op: '+', label: 'Non-taxable / exempt services', value: this.fmtRs(k.NONTAXABLE_INR) },
                    { op: '+', label: 'GST', value: this.fmtRs(k.GST_AMT) }
                ],
                result: { label: 'Billed in Period', value: this.fmtRs(k.BILLED_PERIOD), short: this.fmtShort(k.BILLED_PERIOD) },
                source: 'acc_invoice for the totals; the charge lines (both charge tables) for the taxable / non-taxable split; '
                    + 'GST from the CGST / SGST / IGST columns. Foreign-currency bills are shown at their INR value.',
                notes: ['Taxable + Non-taxable + GST reconciles to the invoice register to the rupee.']
            };
            case 'UNBILLED': return {
                title: 'Unbilled (cost)',
                what: 'Jobs opened in ' + period + ' on which we have already spent money (freight, transport, duty, agency) but have '
                    + 'not yet raised an invoice. Every rupee here is our money until the bill goes out.',
                steps: [
                    { op: '',  label: 'Jobs in the period with no invoice at all', value: n(k.UNBILLED_JOBS).toLocaleString('en-IN') + ' jobs' },
                    { op: '',  label: 'Cost booked on those jobs (purchases + payments + JVs)', value: this.fmtRs(k.UNBILLED_VALUE) }
                ],
                result: { label: 'Unbilled (cost)', value: this.fmtRs(k.UNBILLED_VALUE), short: this.fmtShort(k.UNBILLED_VALUE) },
                source: 'Job list from the export / import masters; "has an invoice" from acc_invjobno; '
                    + 'cost from purchase vouchers, bank / cash payments marked to the job, and JV lines on the job.',
                notes: ['This is what we have SPENT, not what the bill will be worth - the real leakage is higher.',
                        'The Unbilled tab lists every job so billing can act on it; anything over 15 days old should have a reason.']
            };
            case 'MARGIN': return {
                title: 'Margin %',
                what: 'Out of every Rs. 100 we billed on jobs opened in ' + period + ', how much stayed with us after paying the job costs. '
                    + 'Same grain as the Job Profit report (job-wise), taken from the accounts ledger.',
                steps: [
                    { op: '',  label: 'Income (job billing, net of GST)', value: this.fmtRs(k.REVENUE_PERIOD) },
                    { op: '-', label: 'Expense (job cost)', value: this.fmtRs(k.COST_PERIOD) },
                    { op: '=', label: 'Profit', value: this.fmtRs(n(k.REVENUE_PERIOD) - n(k.COST_PERIOD)) },
                    { op: '/', label: 'Income', value: this.fmtRs(k.REVENUE_PERIOD) },
                    { op: 'x', label: '100', value: '' }
                ],
                result: { label: 'Margin %', value: n(k.MARGIN_PCT).toFixed(1) + ' %', short: n(k.MARGIN_PCT) >= 0 ? 'profit' : 'loss so far' },
                source: 'Ledger figures, like every other card. Income = the invoice charge lines of the jobs opened in the period '
                    + '(both charge tables, net of GST, up to the To Date). Expense = purchases, bank / cash payments and JV lines '
                    + 'booked on those jobs. The shipment summary table is used only for service type and duty.',
                notes: ['Customs duty we pay and bill to the client sits outside job income, so clearance-heavy work can read negative even when the service made money.',
                        'A job costed but not yet fully invoiced shows a loss so far - that corrects once it is billed.',
                        'Read margin by service type and client on the Margin tab rather than the single headline %.']
            };
            /* ---------------- PAYABLES ----------------
               Same shape as the receivable cards above, but built from PayKpi. Kept in
               this one switch on purpose: there is a single explainer overlay and a
               single OpenExplain(), so a second copy would only drift. */
            case 'PAY_TOTAL': return {
                title: 'Total Payable',
                what: 'What we still owe our suppliers as on ' + asOn + '. We start from the bills that have not been '
                    + 'knocked off, then deduct money already paid to that supplier which names no bill (advances and '
                    + 'on-account payments).',
                steps: [
                    { op: '',  label: 'Bills pending (bill value not yet knocked off)', value: this.fmtRs(p.GROSS_PENDING) },
                    { op: '-', label: 'Paid but no bill named (advance / on account)', value: this.fmtRs(p.ADVANCE_PAID) }
                ],
                result: { label: 'Total Payable (net)', value: this.fmtRs(p.TOTAL_PAYABLE), short: this.fmtShort(p.TOTAL_PAYABLE) },
                extra: [
                    { label: 'Open bills making it up', value: n(p.OPEN_BILLS).toLocaleString('en-IN') },
                    { label: 'Suppliers involved', value: n(p.SUPPLIER_COUNT).toLocaleString('en-IN') },
                    { label: 'Bills loaded from', value: p.HISTORY_FROM + ' (' + p.HISTORY_MONTHS + ' months)' }
                ],
                source: 'Bills from acc_purchase / acc_purchasedtls. A bill counts as PAID when a line on a Bank Payment, '
                    + 'Cash Payment or Cash Expense voucher (BP / CP / CE) names that bill number - the supplier side does '
                    + 'not use the "Against Bill" flag the receipt side uses.',
                notes: ['A bill\'s value is Amount + Deduction. Those are two alternative value columns in this ERP, not '
                        + 'value-and-TDS; TDS has its own column. Reading them the other way understated this figure.',
                        'Calculated per supplier and floored at zero - one supplier\'s advance never reduces what we owe another.',
                        'Direct job cost paid with no purchase bill behind it is excluded: it can never settle a payable.',
                        'Only bills raised inside the History window are loaded. Widen it if you are reconciling.']
            };
            case 'PAY_OVERDUE': return {
                title: 'Overdue',
                what: 'The part of the payable that is already past its pay-by date on ' + asOn + '. This is money the '
                    + 'supplier is entitled to chase us for today.',
                steps: [
                    { op: '',  label: 'For each open bill: due date = the date keyed on the bill', value: '' },
                    { op: '',  label: 'if that date is missing or not credible, bill date + 30 days', value: '' },
                    { op: '',  label: 'Add up every bill whose due date is before ' + asOn, value: '' }
                ],
                result: { label: 'Overdue', value: this.fmtRs(p.OVERDUE_AMT), short: this.fmtShort(p.OVERDUE_AMT) },
                extra: [
                    { label: 'Share of Total Payable', value: this.payOverduePct().toFixed(0) + ' %' },
                    { label: 'Oldest bill still open', value: n(p.OLDEST_BILL_DAYS).toLocaleString('en-IN') + ' days' },
                    { label: 'Bills carrying a usable due date', value: n(p.PCT_WITH_DUEDATE).toFixed(0) + ' %' },
                    { label: 'Due dates rejected as not credible', value: n(p.DUEDATE_IGNORED).toLocaleString('en-IN') }
                ],
                source: 'Due date from acc_purchase.pur_duedt, accepted only when it falls 0 to 180 days AFTER the bill '
                    + 'date. Anything outside that - including due dates keyed before the bill date - is ignored and the '
                    + '30-day assumption is used instead. Every rejected bill is listed on the Data to fix view.',
                notes: ['Where the due date was assumed, "overdue" is our assumption, not an agreed term.',
                        'A high overdue share alongside a low DPO usually means old residue that was never knocked off, '
                        + 'not that we are paying late today - check the oldest bills first.']
            };
            case 'PAY_DUE': return {
                title: 'Falling due',
                what: 'Bills that are NOT yet overdue but come due shortly. This is the cash we have to find next. '
                    + 'Each figure is cumulative from today, so the 30-day figure includes the 7 and 15-day ones.',
                steps: [
                    { op: '',  label: 'Due within 7 days', value: this.fmtRs(p.DUE_7) },
                    { op: '',  label: 'Due within 15 days (includes the 7-day figure)', value: this.fmtRs(p.DUE_15) },
                    { op: '',  label: 'Due within 30 days (includes the 15-day figure)', value: this.fmtRs(p.DUE_30) }
                ],
                result: { label: 'Falling due in 7 days', value: this.fmtRs(p.DUE_7), short: this.fmtShort(p.DUE_7) },
                extra: [
                    { label: 'Already overdue (counted separately, NOT included above)', value: this.fmtRs(p.OVERDUE_AMT) }
                ],
                source: 'The same due date as the Overdue card: the date on the bill when it is credible, otherwise bill '
                    + 'date + 30 days.',
                notes: ['Overdue money is deliberately kept out of these buckets - it is not "falling due", it is late.',
                        'Where the due date was assumed the bill may really be due earlier or later than shown.',
                        'The Cash forecast below puts these against expected collections.']
            };
            case 'PAY_DPO': return {
                title: 'DPO (days we take to pay)',
                what: 'How many days we actually take to pay a supplier, for bills raised in ' + period + ' that have '
                    + 'since been settled. Big bills count more than small ones (value-weighted), so a handful of tiny '
                    + 'bills cannot distort it.',
                steps: [
                    { op: '',  label: 'For each settled bill: days = payment date - bill date', value: '' },
                    { op: '',  label: 'Weighted average = sum(days x bill value) / sum(bill value)',
                      value: (p.DPO_DAYS === null || p.DPO_DAYS === undefined) ? '-' : n(p.DPO_DAYS).toFixed(1) + ' days' }
                ],
                result: { label: 'DPO', value: (p.DPO_DAYS === null || p.DPO_DAYS === undefined) ? '-' : n(p.DPO_DAYS).toFixed(1) + ' days',
                          short: 'average across settled bills' },
                extra: [
                    { label: 'Fastest bill settled', value: n(p.FASTEST_PAID_DAYS).toFixed(0) + ' days' },
                    { label: 'Slowest bill settled', value: n(p.SLOWEST_PAID_DAYS).toFixed(0) + ' days' }
                ],
                source: 'Bill date from acc_purchase; payment date = the LAST payment voucher line naming that bill.',
                notes: ['Compare with Recovery on the Overview tab. Paying suppliers faster than customers pay us means '
                        + 'we are funding the gap out of our own cash.',
                        'Only bills raised in the period AND settled are counted - bills still open are not in this average, '
                        + 'so DPO can look healthy while the Overdue card does not.']
            };
            case 'PAY_PURCHASED': return {
                title: 'Purchased in period',
                what: 'The value of supplier bills we booked between ' + period + '. This is what we committed to pay, '
                    + 'whether or not it has been paid yet.',
                steps: [
                    { op: '',  label: 'Bills booked in the period', value: n(p.BILLS_IN_PERIOD).toLocaleString('en-IN') + ' bills' },
                    { op: '',  label: 'Gross billed (charge lines: Amount + Deduction)', value: this.fmtRs(p.GROSS_BILLED_PERIOD) },
                    { op: '-', label: 'TDS deducted on those bills', value: this.fmtRs(p.TDS_DEDUCTED_PERIOD) }
                ],
                result: { label: 'Purchased (net of TDS)', value: this.fmtRs(p.PURCHASED_PERIOD), short: this.fmtShort(p.PURCHASED_PERIOD) },
                source: 'acc_purchasedtls charge lines, grouped by the bill date on acc_purchase. TDS comes from the '
                    + 'TDS_AMT column on the line.',
                notes: ['A charge line puts its value in EITHER the Amount column or the Deduction column - both are '
                        + 'value columns, so both are added. Only 27 lines in 17 lakh use both, and those bills are '
                        + 'listed on the Data to fix view.',
                        'This is bills BOOKED in the period, not bills paid - see the Paid card for cash going out.',
                        'Bills whose date cannot be read are excluded entirely and are listed on Data to fix.']
            };
            case 'PAY_PAID': return {
                title: 'Paid in period',
                what: 'Money that actually went out to suppliers between ' + period + ' against a named bill.',
                steps: [
                    { op: '',  label: 'Payment lines on BP / CP / CE vouchers that name a bill', value: this.fmtRs(p.PAID_PERIOD) }
                ],
                result: { label: 'Paid in period', value: this.fmtRs(p.PAID_PERIOD), short: this.fmtShort(p.PAID_PERIOD) },
                extra: [
                    { label: 'Direct job cost paid with no purchase bill behind it', value: this.fmtRs(p.JOBCOST_PAID_PERIOD) },
                    { label: 'Suppliers paid', value: n(p.SUPPLIER_COUNT).toLocaleString('en-IN') }
                ],
                source: 'acc_bankdtls lines on vouchers with status BP (Bank Payment), CP (Cash Payment) or CE (Cash '
                    + 'Expense), where the line carries a bill number. Both the Amount and the Deduction column are '
                    + 'counted - like the purchase side, they are two value columns.',
                notes: ['Direct job cost is shown separately, not added: it is cost booked straight to a job with no '
                        + 'purchase bill, so it can never settle a payable.',
                        'A payment that names no bill at all is an advance and appears on the Total Payable card instead.']
            };
        }
        return null;
    }

    /* Esc closes the top-most overlay: job drawer, then the KPI popup, the reminder and the
       client popup. The legend is an inline Reference section now, so Esc leaves it alone. */
    @HostListener('document:keydown.escape')
    onEsc() {
        if (this.JobDrawerNo) { this.CloseJobDrawer(); }
        else if (this.ExplainKey) { this.CloseExplain(); }
        else if (this.ReminderOpen) { this.CloseReminder(); }
        else if (this.DrillClient) { this.CloseDrill(); }
    }

    ExportExposure() {
        if (!this.Exposure || this.Exposure.length === 0) {
            this._toasterService.toast('warning', 'warning', 'Nothing to export !');
            return;
        }
        const headers = Object.keys(this.Exposure[0]);
        const rows = this.Exposure.map(r => headers.map(h => r[h]));
        const reportData = {
            data: rows,
            headers: headers,
            pagetype: 'FinanceDashboard',
            title: this.cmpnyname,
            subtitle: 'Client Exposure - ' + this.BranchLabel + ' - '
                + this.fmtDate(this.FromDate) + ' to ' + this.fmtDate(this.ToDate)
        };
        this.exportser.exportExceltry(reportData, 'FinanceDashboard_Exposure_');
    }

    // ---- redesign: view state, pagers and inline-SVG chart geometry (display only) ----
    Loading = false;
    LoadFailed = false;
    NoData = false;
    expPager = new FinPager<any>(10);
    agePager = new FinPager<any>(10);
    marginPager = new FinPager<any>(10);
    unbilledPager = new FinPager<any>(10);
    RecoveryBars: { label: string; x: number; cw: number; ch: number; aw: number; ah: number; credit: number; actual: number }[] = [];
    RecoveryGrid: { y: number; label: string }[] = [];
    readonly recW = 760;
    readonly recH = 220;
    AgeingBars: { label: string; value: number; pct: number }[] = [];
    MixBars: { label: string; value: number; pct: number }[] = [];
    CoverageBars: { label: string; value: number; pct: number }[] = [];

    BuildView() {
        this.expPager.set(this.Exposure);
        this.agePager.set(this.Ageing);
        this.marginPager.set(this.MarginSorted());
        this.unbilledPager.set(this.UnbilledSorted());
        this.actRecPager.set((this.Exposure || []).filter(r => this.num(r.OVERDUE) > 0.01)
            .sort((a, b) => this.num(b.OVERDUE) - this.num(a.OVERDUE)));
        this.actUnbPager.set((this.UnbilledJobs || []).slice()
            .sort((a, b) => this.num(b.AGE_DAYS) - this.num(a.AGE_DAYS)));
        this.BuildMarginBars();

        /* credit period vs actual recovery days (same fields BuildCharts uses) */
        const rows = this.Recovery || [];
        const l = 40, r = 10, t = 10, b = 40;
        const max = Math.max(1, ...rows.map(x => Math.max(this.num(x.CREDIT_PERIOD), this.num(x.ACTUAL_DAYS_WTD))));
        const plotH = this.recH - t - b, slot = rows.length ? (this.recW - l - r) / rows.length : 0;
        const bw = Math.max(3, Math.min(18, slot * 0.34));
        /* a prepaid client has NEGATIVE recovery days: draw it as a zero-height bar (the
           tooltip still shows the real figure) instead of an invalid negative <rect> height */
        const yOf = (v: number) => t + plotH - (Math.max(0, v) / max) * plotH;
        this.RecoveryBars = rows.map((x, i) => {
            const c = this.num(x.CREDIT_PERIOD), a = this.num(x.ACTUAL_DAYS_WTD);
            const cx = l + i * slot + slot / 2 - bw - 1;
            return { label: this.shortName(x.CLIENTNAME), x: cx, cw: bw, ch: yOf(c), aw: bw, ah: yOf(a), credit: c, actual: a };
        });
        this.RecoveryGrid = [0, 0.25, 0.5, 0.75, 1].map(f => ({ y: yOf(max * f), label: String(Math.round(max * f)) }));

        const share = (items: { label: string; value: number }[]) => {
            const tot = items.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
            return items.map(x => ({ label: x.label, value: x.value, pct: Math.max(0, Math.min(100, x.value / tot * 100)) }));
        };
        const ageTotals = (this.ageingData && this.ageingData[0] && this.ageingData[0].data) ? this.ageingData[0].data : [];
        this.AgeingBars = share(this.ageingLabels.map((lab, i) => ({ label: lab + ' days', value: this.num(ageTotals[i]) })));
        this.MixBars = share(this.mixLabels.map((lab, i) => ({ label: lab, value: this.num(this.mixData[0].data[i]) })));
        const cv = this.Coverage;
        this.CoverageBars = cv ? share([
            { label: 'Billed within 7 days', value: this.num(cv.LAG_0_7) },
            { label: '8 - 15 days', value: this.num(cv.LAG_8_15) },
            { label: '16 - 30 days', value: this.num(cv.LAG_16_30) },
            { label: '31 - 60 days', value: this.num(cv.LAG_31_60) },
            { label: 'Over 60 days', value: this.num(cv.LAG_60P) },
            { label: 'Still unbilled', value: this.num(cv.UNBILLED_JOBS) }
        ]) : [];
    }
    unbilledAgeMax(): number { return Math.max(1, ...(this.UnbilledAge || []).map(u => this.num(u.COST_VALUE))); }

    /* ---- priority layout: Act now / This week / Workload / Reference (display only) ---- */
    actRecPager = new FinPager<any>(10);
    actPayPager = new FinPager<any>(10);
    actUnbPager = new FinPager<any>(10);
    WeekBills: { day: string; total: number; rows: any[] }[] = [];
    MarginBars: { name: string; rev: number; margin: number; mpct: number; pct: number }[] = [];
    RefExplainOpen = false;
    RefAuditOpen = false;
    readonly ExplainKeys = ['EXPOSURE', 'OUTSTANDING', 'RECOVERY', 'BILLED', 'UNBILLED', 'MARGIN',
        'PAY_TOTAL', 'PAY_OVERDUE', 'PAY_DUE', 'PAY_DPO', 'PAY_PURCHASED', 'PAY_PAID'];

    ScrollTo(id: string) {
        setTimeout(() => {
            const el = document.getElementById(id);
            if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        }, 0);
    }
    GoDetail(tab: string) { this.SetTab(tab); this.ScrollTo('fd-s-detail'); }
    ShowLegend() { this.LegendOpen = true; this.ScrollTo('fd-legend'); }
    ToggleRefAudit() {
        this.RefAuditOpen = !this.RefAuditOpen;
        if (this.RefAuditOpen && !this.AuditLoaded && !this.AuditLoading) { this.LoadAudit(); }
    }

    /* overdue bills (Act now) and bills due in the next 7 days grouped by day (This week),
       both from the payables bill list already loaded */
    SetPayDerived() {
        const bills = this.PayBills || [];
        this.actPayPager.set(bills.filter(b => this.num(b.OVERDUE_DAYS) > 0)
            .sort((a, b) => this.num(b.OVERDUE_DAYS) - this.num(a.OVERDUE_DAYS)));
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const groups: { [k: string]: { day: string; t: number; total: number; rows: any[] } } = {};
        for (const b of bills) {
            if (this.num(b.OVERDUE_DAYS) > 0) { continue; }
            const d = this.parseDay(b.DUE_DATE);
            if (!d) { continue; }
            const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
            if (diff < 0 || diff > 7) { continue; }
            const k = b.DUE_DATE;
            if (!groups[k]) { groups[k] = { day: k, t: d.getTime(), total: 0, rows: [] }; }
            groups[k].rows.push(b);
            groups[k].total += this.num(b.PENDING);
        }
        this.WeekBills = Object.keys(groups).map(k => groups[k]).sort((a, b) => a.t - b.t)
            .map(g => ({ day: g.day, total: g.total, rows: g.rows }));
    }
    /* dd/mm/yyyy, dd-mm-yyyy or dd-Mon-yyyy */
    private parseDay(v: any): Date {
        if (!v) { return null; }
        const m = v.toString().trim().match(/^(\d{1,2})[\/\-\s]([A-Za-z]{3}|\d{1,2})[\/\-\s](\d{2,4})/);
        if (!m) { return null; }
        const mons = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const mo = isNaN(+m[2]) ? mons.indexOf(m[2].toUpperCase()) : +m[2] - 1;
        let y = +m[3]; if (y < 100) { y += 2000; }
        if (mo < 0) { return null; }
        return new Date(y, mo, +m[1]);
    }

    /* margin by billed party / shipper: rows summed per party, top 8 by income */
    BuildMarginBars() {
        const by: { [k: string]: { name: string; rev: number; margin: number } } = {};
        for (const r of this.MarginRows()) {
            const k = r.CLIENTCODE || r.CLIENTNAME;
            if (!by[k]) { by[k] = { name: r.CLIENTNAME, rev: 0, margin: 0 }; }
            by[k].rev += this.num(r.REVENUE);
            by[k].margin += this.num(r.MARGIN);
        }
        const top = Object.keys(by).map(k => by[k]).sort((a, b) => b.rev - a.rev).slice(0, 8);
        const max = Math.max(1, ...top.map(x => Math.abs(x.margin)));
        this.MarginBars = top.map(x => ({
            name: x.name, rev: x.rev, margin: x.margin,
            mpct: x.rev !== 0 ? x.margin / x.rev * 100 : null,
            pct: Math.abs(x.margin) / max * 100
        }));
    }
}
