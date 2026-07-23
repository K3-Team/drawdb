import { useMemo, useState } from "react";
import { Banner, Button, Input, Spin } from "@douyinfe/semi-ui";
import { useTranslation } from "react-i18next";
import { useDiagramList } from "./hooks/useDiagramList";
import {
  ALL,
  databaseOptions,
  filterDiagrams,
  mergeDiagrams,
  nextSort,
  sortDiagrams,
} from "./diagram";
import DiagramFilters from "./components/DiagramFilters";
import DiagramTable from "./components/DiagramTable";

const DEFAULT_SORT = { key: "lastModified", dir: "desc" };

function InfoBanner({ type, children }) {
  return (
    <Banner
      fullMode={false}
      type={type}
      bordered
      icon={null}
      closeIcon={null}
      description={<div>{children}</div>}
    />
  );
}

export default function Open({ selectedDiagramId, setSelectedDiagramId }) {
  const { t } = useTranslation();
  const {
    loading,
    error,
    unauthorized,
    cloud,
    local,
    cloudEnabled,
    currentUserId,
    refresh,
  } = useDiagramList();

  const [query, setQuery] = useState("");
  const [database, setDatabase] = useState(ALL);
  const [source, setSource] = useState(ALL);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [tokenInput, setTokenInput] = useState("");

  const submitToken = () => {
    const token = tokenInput.trim();
    if (token === "") return;
    // diagramApi reads the token from localStorage on every request, so storing
    // it and re-fetching is enough to retry the listing with the new token --
    // no page reload, so the Open dialog stays put and reveals the list.
    localStorage.setItem("drawdb-collab-token", token);
    setTokenInput("");
    refresh();
  };

  const clearFilters = () => {
    setQuery("");
    setDatabase(ALL);
    setSource(ALL);
  };

  const diagrams = useMemo(() => mergeDiagrams(cloud, local), [cloud, local]);
  const dbOptions = databaseOptions(diagrams);
  const visible = useMemo(
    () =>
      sortDiagrams(filterDiagrams(diagrams, { query, database, source }), sort),
    [diagrams, query, database, source, sort],
  );

  const showOwner =
    cloudEnabled &&
    visible.some(
      (entry) =>
        entry.owner && String(entry.owner.id) !== String(currentUserId),
    );

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spin />
      </div>
    );
  }

  if (unauthorized) {
    return (
      <div className="space-y-3">
        <InfoBanner type="warning">{t("access_token_required")}</InfoBanner>
        <Input
          placeholder={t("enter_access_token")}
          value={tokenInput}
          onChange={setTokenInput}
          onEnterPress={submitToken}
        />
        <div className="flex justify-end">
          <Button
            theme="solid"
            disabled={tokenInput.trim() === ""}
            onClick={submitToken}
          >
            {t("save")}
          </Button>
        </div>
      </div>
    );
  }

  if (error) return <InfoBanner type="danger">{error}</InfoBanner>;

  if (diagrams.length === 0) {
    return <InfoBanner type="info">{t("no_saved_diagrams")}</InfoBanner>;
  }

  return (
    <div className="flex flex-col">
      <DiagramFilters
        query={query}
        onQueryChange={setQuery}
        database={database}
        onDatabaseChange={setDatabase}
        databaseOptions={dbOptions}
        source={source}
        onSourceChange={setSource}
        showSourceFilter={cloudEnabled}
        onClear={clearFilters}
      />
      <div className="max-h-[360px] overflow-auto">
        {visible.length > 0 ? (
          <DiagramTable
            entries={visible}
            sort={sort}
            onSort={(key) => setSort((current) => nextSort(current, key))}
            selectedDiagramId={selectedDiagramId}
            onSelect={setSelectedDiagramId}
            showType={cloudEnabled}
            showOwner={showOwner}
            currentUserId={currentUserId}
          />
        ) : (
          <div className="text-sm text-zinc-500 dark:text-zinc-400 px-1 py-6 text-center">
            {t("no_diagrams_match")}
          </div>
        )}
      </div>
    </div>
  );
}
